use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

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
    tauri::Builder::default()
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
