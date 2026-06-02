use std::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the running Go backend child process so we can kill it on app exit.
struct BackendProcess(Mutex<Option<CommandChild>>);

/// Spawn the bundled Go backend as a sidecar. Logs stdout/stderr lines via
/// `eprintln!` so they appear in the Tauri dev console (and Console.app for
/// release builds).
fn spawn_backend(app: &tauri::App) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let sidecar = app.shell().sidecar("cogload-backend")?;
    let (mut rx, child) = sidecar.spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    eprintln!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[backend] exited: code={:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Cogload is running.", name)
}

/// Build the native menu bar with App, Edit, and Window submenus.
fn build_menu(
    app: &tauri::App,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    // ── App submenu ──────────────────────────────────────────────────
    let app_submenu = SubmenuBuilder::new(app, "Cogload")
        .about(None) // uses metadata from tauri.conf.json
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // ── Edit submenu ─────────────────────────────────────────────────
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    // ── Window submenu ───────────────────────────────────────────────
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize() // "Zoom" on macOS
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .build()?;

    Ok(menu)
}

/// Build the system tray icon with a context menu.
fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItemBuilder::with_id("tray_show", "Show Window").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;

    let tray_menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("default window icon must be set in tauri.conf.json")
                .clone(),
        )
        .tooltip("Cogload")
        .menu(&tray_menu)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "tray_show" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray_quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on the tray icon brings the window to the front.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            // ── Title bar style (macOS) ──────────────────────────────
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    use tauri::TitleBarStyle;
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            // ── Native menu bar ──────────────────────────────────────
            let menu = build_menu(app).expect("failed to build native menu");
            app.set_menu(menu)?;

            // ── System tray ──────────────────────────────────────────
            build_tray(app).expect("failed to build system tray");

            // ── Backend sidecar ──────────────────────────────────────
            // Spawn the Go daemon bundled inside the app. If the binary is
            // missing (e.g. running `cargo run` without first building the
            // sidecar), log and continue so the UI still works with demo data.
            match spawn_backend(app) {
                Ok(child) => {
                    app.manage(BackendProcess(Mutex::new(Some(child))));
                }
                Err(err) => {
                    eprintln!("[backend] failed to spawn sidecar: {err}");
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(state) = app_handle.try_state::<BackendProcess>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
