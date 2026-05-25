import {
  useEffect,
  useRef,
  useCallback,
  useState,
  lazy,
  Suspense,
} from "react";
import { useAppStore } from "./store/app-store";
import type { Mode } from "./types";
import { startSignalStream, stopSignalStream } from "./store/ws-client";
import {
  startOfflineDetection,
  stopOfflineDetection,
  isOffline,
  onOfflineChange,
} from "./api/offline";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import SelfReport from "./components/shared/SelfReport";
import Onboarding from "./components/shared/Onboarding";
import { api } from "./api/client";
import "./styles/desktop.css";
import "./styles/modes.css";
import "./styles/block-budget.css";
import "./styles/threads.css";
import "./styles/map.css";

// Lazy-load mode components — only the active mode is loaded

const TodayMode = lazy(() => import("./components/modes/TodayMode"));

const ReviewMode = lazy(() => import("./components/modes/ReviewMode"));
const TomorrowMode = lazy(() => import("./components/modes/TomorrowMode"));
const SourcesMode = lazy(() => import("./components/modes/SourcesMode"));
const SettingsMode = lazy(() => import("./components/modes/SettingsMode"));
const BlockBudgetMode = lazy(
  () => import("./components/modes/BlockBudgetMode"),
);
const ThreadsMode = lazy(() => import("./components/modes/ThreadsMode"));
const MapMode = lazy(() => import("./components/modes/MapMode"));

const MODES: { id: Mode; label: string }[] = [
  { id: "blocks", label: "Blocks" },
  { id: "today", label: "Today" },
  { id: "map", label: "Map" },

  { id: "review", label: "Review" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "threads", label: "Threads" },
  { id: "sources", label: "Sources" },
  { id: "settings", label: "Settings" },
];

function suggestedMode(hour: number): Mode {
  if (hour < 9) return "tomorrow";
  if (hour < 17) return "blocks";
  if (hour < 20) return "review";
  return "today";
}

export default function App() {
  const {
    mode,
    setMode,
    tasks,
    setTasks,
    setBandwidth,
    focus,
    toast,
    setToast,
    now,
    setNow,
    signals,
    dismissedRules,
    dismissRule,
    setPendingAction,
  } = useAppStore();

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [setNow]);

  // Claude status
  const [claudeOnline, setClaudeOnline] = useState(false);
  const [claudeMasked, setClaudeMasked] = useState("");
  const [claudePanel, setClaudePanel] = useState(false);
  const [claudeKeyInput, setClaudeKeyInput] = useState("");
  const [claudeKeySaving, setClaudeKeySaving] = useState(false);
  const [claudeKeyError, setClaudeKeyError] = useState("");
  const [claudeKeySaved, setClaudeKeySaved] = useState(false);
  const claudeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .claudeStatus()
      .then((s) => {
        setClaudeOnline(s.online);
        if (s.masked_key) setClaudeMasked(s.masked_key);
      })
      .catch(() => {});
  }, []);

  // Focus input when panel opens
  useEffect(() => {
    if (claudePanel && claudeInputRef.current) {
      claudeInputRef.current.focus();
    }
  }, [claudePanel]);

  const handleSetClaudeKey = async () => {
    const key = claudeKeyInput.trim();
    if (!key) return;
    setClaudeKeySaving(true);
    setClaudeKeyError("");
    try {
      await api.setClaudeKey(key);
      setClaudeOnline(true);
      setClaudeKeyInput("");
      // Show saved confirmation then collapse
      const masked =
        key.length > 8 ? key.slice(0, 4) + "..." + key.slice(-4) : "****";
      setClaudeMasked(masked);
      setClaudeKeySaved(true);
      setTimeout(() => {
        setClaudeKeySaved(false);
        setClaudePanel(false);
      }, 1500);
    } catch {
      setClaudeKeyError("Failed to save key. Is the backend running?");
    }
    setClaudeKeySaving(false);
  };

  // WebSocket signal stream + offline detection
  const [offline, setOffline] = useState(isOffline());
  useEffect(() => {
    startSignalStream();
    startOfflineDetection();
    const unsub = onOfflineChange(setOffline);
    return () => {
      stopSignalStream();
      stopOfflineDetection();
      unsub();
    };
  }, []);

  // Drive toast from interventions (skip dismissed rules)
  useEffect(() => {
    if (!signals) return;
    const interventions = Array.isArray(signals.interventions)
      ? signals.interventions
      : [];
    const warn = interventions.find(
      (i) =>
        i &&
        (i.severity === "warn" || i.severity === "info") &&
        !dismissedRules.has(i.rule),
    );
    if (warn?.title && warn?.action?.label && !toast) {
      setToast({
        msg: warn.title,
        action: warn.action.label,
        actionKind: warn.action.kind,
        action2: warn.action2?.label,
        action2Kind: warn.action2?.kind,
        rule: warn.rule,
      });
    }
  }, [signals, toast, setToast, dismissedRules]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") setMode("today");
        return;
      }
      if (e.key === "1") setMode("blocks");
      if (e.key === "2") setMode("today");
      if (e.key === "3") setMode("map");
      if (e.key === "4") setMode("review");
      if (e.key === "5") setMode("tomorrow");
      if (e.key === "6") setMode("threads");
      if (e.key === "7") setMode("sources");
      if (e.key === "8") setMode("settings");
      if (e.key === "Escape") setMode("today");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  // Fetch tasks from API
  useEffect(() => {
    api
      .getToday()
      .then((data) => {
        if (data.tasks) setTasks(data.tasks);
        if (data.bandwidth) setBandwidth(data.bandwidth);
      })
      .catch(() => {}); // Backend not running — store keeps defaults
  }, [setTasks, setBandwidth]);

  const hour = now.getHours() + now.getMinutes() / 60;
  const auto = suggestedMode(hour);
  const completed = tasks.filter((t) => t.done).length;

  // Signals from WebSocket or defaults
  const sig = signals ?? {
    focus_state: "stable" as const,
    active_threads: 0,
    error_rate: 0,
    error_baseline: 1.0,
    open_loops: 0,
    cutoff_hour: 16.5,
    cognitive_threshold_pct: 0,
    interventions: [],
    momentum_velocity: 0,
    momentum_peak: 0,
    wall_detected: false,
  };

  const cutoffHH = Math.floor(sig.cutoff_hour);
  const cutoffMM = Math.round((sig.cutoff_hour % 1) * 60)
    .toString()
    .padStart(2, "0");

  // Liquid nav blob — tracks active button position with spring physics
  const pillsRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);
  const blobPos = useRef({ x: 0, w: 0, targetX: 0, targetW: 0, velocity: 0 });
  const rafRef = useRef<number>(0);
  const [transitioning, setTransitioning] = useState(false);

  const updateBlob = useCallback((el: HTMLElement, instant?: boolean) => {
    const pills = pillsRef.current;
    if (!pills || !blobRef.current) return;
    const pillsRect = pills.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const x = rect.left - pillsRect.left;
    const w = rect.width;

    if (instant) {
      blobPos.current = { x, w, targetX: x, targetW: w, velocity: 0 };
      blobRef.current.style.transform = `translateX(${x}px)`;
      blobRef.current.style.width = `${w}px`;
      return;
    }

    const prev = blobPos.current;
    prev.velocity = Math.abs(x - prev.targetX);
    prev.targetX = x;
    prev.targetW = w;

    // Animate with spring
    const animate = () => {
      const p = blobPos.current;
      const dx = p.targetX - p.x;
      const dw = p.targetW - p.w;

      // Spring constant — fast convergence
      p.x += dx * 0.25;
      p.w += dw * 0.2;
      p.velocity *= 0.85;

      // Distortion: stretch horizontally based on velocity
      const stretch = Math.min(p.velocity * 0.4, 20);
      const scaleX = 1 + stretch / Math.max(p.w, 1);
      const scaleY = 1 / (0.7 + 0.3 * scaleX); // squish vertically to conserve volume

      if (blobRef.current) {
        blobRef.current.style.transform = `translateX(${p.x}px) scaleX(${scaleX.toFixed(3)}) scaleY(${scaleY.toFixed(3)})`;
        blobRef.current.style.width = `${p.w}px`;
      }

      if (Math.abs(dx) > 0.3 || Math.abs(dw) > 0.3 || p.velocity > 0.5) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        // Snap to final position
        if (blobRef.current) {
          blobRef.current.style.transform = `translateX(${p.targetX}px)`;
          blobRef.current.style.width = `${p.targetW}px`;
        }
        p.x = p.targetX;
        p.w = p.targetW;
        p.velocity = 0;
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  // Position blob on mount and when mode changes
  useEffect(() => {
    const pills = pillsRef.current;
    if (!pills) return;
    const activeBtn = pills.querySelector("button.on") as HTMLElement;
    if (activeBtn) updateBlob(activeBtn, true);
  }, [mode, updateBlob]);

  const handleNavHover = useCallback(
    (id: Mode, e: React.MouseEvent<HTMLButtonElement>) => {
      setTransitioning(true);
      updateBlob(e.currentTarget);
      // Switch mode instantly — the blob animation IS the transition
      setMode(id);
      setTimeout(() => setTransitioning(false), 80);
    },
    [setMode, updateBlob],
  );

  return (
    <div className="app-shell">
      {/* Top nav — sits under native titlebar overlay area */}
      <div className="topnav" data-tauri-drag-region="">
        <div className="nav-brand">
          <i>c</i>Cogload
        </div>
        <div className="nav-pills" ref={pillsRef}>
          <div className="nav-blob" ref={blobRef} />
          {MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? "on" : ""}
              onClick={() => setMode(m.id)}
              onMouseEnter={(e) => handleNavHover(m.id, e)}
            >
              {m.label}
              {m.id === "threads" && sig.active_threads > 0 && (
                <span className="nav-thread-badge">{sig.active_threads}</span>
              )}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <span className="auto-hint">auto · {auto}</span>
          <span>
            <b>{completed}</b>/{tasks.length} closed
          </span>
        </div>
      </div>

      {/* Signal strip */}
      <div className="signals">
        <div className="signal">
          <span
            className={`sd ${sig.focus_state === "degraded" ? "danger" : sig.active_threads >= 2 ? "warn" : ""}`}
          ></span>
          <span className="signal-label">Focus</span>
          <b>{sig.focus_state}</b>
        </div>
        <div className="signal">
          <span
            className={`sd ${sig.error_rate > 2 ? "danger" : sig.error_rate > 1.3 ? "warn" : ""}`}
          ></span>
          <span className="signal-label">Errors</span>
          <b>{(sig.error_rate ?? 0).toFixed(1)}×</b>
          <span style={{ color: "var(--color-overcast)" }}>baseline</span>
        </div>
        <div className="signal">
          <span
            className={`sd ${hour > sig.cutoff_hour ? "danger" : ""}`}
          ></span>
          <span className="signal-label">Cutoff</span>
          <b>
            {cutoffHH}:{cutoffMM}
          </b>
          <span style={{ color: "var(--color-overcast)" }}>
            {hour > sig.cutoff_hour
              ? "past"
              : `in ${Math.round((sig.cutoff_hour - hour) * 60)}m`}
          </span>
        </div>
        <div
          className="signal signal-claude"
          onClick={() => setClaudePanel((v) => !v)}
        >
          <span
            className={`signal-claude-dot ${claudeOnline ? "online" : "offline"}`}
          ></span>
          <span className="signal-label">Claude</span>
          <b>{claudeOnline ? "online" : "offline"}</b>
        </div>
        <div
          className="signal"
          style={{ marginLeft: "auto", color: "var(--color-overcast)" }}
        >
          {(sig.interventions ?? []).length} rules
        </div>
        {sig.wall_detected && (
          <div className="signal" style={{ color: "var(--color-danger-red)" }}>
            <span className="sd danger"></span>
            <span className="signal-label">Wall</span>
            <b>detected</b>
          </div>
        )}
      </div>

      {/* Claude API key expandable panel */}
      <div className={`claude-panel ${claudePanel ? "on" : ""}`}>
        <div className="claude-panel-inner">
          <div className="claude-panel-status">
            <span
              className={`signal-claude-dot ${claudeOnline ? "online" : "offline"}`}
            ></span>
            <span className="claude-panel-title">
              {claudeOnline
                ? "Claude connected"
                : "Connect Claude for AI-powered estimates"}
            </span>
            {claudeOnline && claudeMasked && (
              <span className="claude-panel-masked">{claudeMasked}</span>
            )}
            <button
              className="claude-panel-close"
              onClick={() => setClaudePanel(false)}
            >
              ×
            </button>
          </div>
          {claudeOnline ? (
            <div className="claude-panel-desc">
              AI estimation is active. Task estimates and daily analysis use
              Claude for higher-confidence results.
              <button
                className="claude-panel-rekey"
                onClick={() => setClaudeOnline(false)}
              >
                Change key
              </button>
            </div>
          ) : (
            <>
              <div className="claude-panel-desc">
                Add your Anthropic API key to enable AI-powered task estimation
                and daily analysis. The key is saved to{" "}
                <code>~/.cogload/config.json</code>.
              </div>
              <div className="claude-panel-form">
                <input
                  ref={claudeInputRef}
                  className="claude-panel-input"
                  type="password"
                  placeholder="sk-ant-api03-..."
                  value={claudeKeyInput}
                  onChange={(e) => setClaudeKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSetClaudeKey();
                    if (e.key === "Escape") setClaudePanel(false);
                  }}
                />
                <button
                  className="btn-primary claude-panel-save"
                  onClick={handleSetClaudeKey}
                  disabled={claudeKeySaving || !claudeKeyInput.trim()}
                >
                  {claudeKeySaving
                    ? "Saving…"
                    : claudeKeySaved
                      ? "✓ Saved"
                      : "Save key"}
                </button>
              </div>
              {claudeKeyError && (
                <div className="claude-panel-error">{claudeKeyError}</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="content-area">
        <div
          className={`stage ${transitioning ? "stage-exit" : "stage-enter"}`}
        >
          <ErrorBoundary key={mode}>
            <Suspense
              fallback={
                <div
                  style={{
                    padding: "48px",
                    textAlign: "center",
                    color: "var(--color-overcast)",
                  }}
                >
                  Loading…
                </div>
              }
            >
              {mode === "blocks" && <BlockBudgetMode />}
              {mode === "today" && <TodayMode />}
              {mode === "map" && <MapMode />}

              {mode === "review" && <ReviewMode />}
              {mode === "tomorrow" && <TomorrowMode />}
              {mode === "threads" && <ThreadsMode />}
              {mode === "sources" && <SourcesMode />}
              {mode === "settings" && <SettingsMode />}
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span>
          <span className={`sb-dot ${toast ? "warn" : ""}`}></span>
          {toast ? toast.msg : "all signals nominal"}
        </span>
        <span>
          Errors · <b>{(sig.error_rate ?? 0).toFixed(1)}×</b>
        </span>
        <span>
          Cutoff ·{" "}
          <b>
            {cutoffHH}:{cutoffMM}
          </b>
        </span>
        <span>
          Velocity ·{" "}
          <b>
            {sig.momentum_velocity
              ? `${Math.round(sig.momentum_velocity)}`
              : "0"}
          </b>{" "}
          ev/h
        </span>
        <div className="sb-spacer"></div>
        {toast && (
          <span
            className="sb-link"
            onClick={() => {
              setToast(null);
              setMode("threads");
            }}
          >
            Triage threads →
          </span>
        )}
        <span>{offline ? "⚠ offline" : "v0.5 · synced"}</span>
      </div>

      {/* Self-report edge panel */}
      <SelfReport />

      {/* Onboarding wizard — shown on first launch */}
      <Onboarding />

      {/* Toast */}
      {toast && (
        <div className="toast on">
          <span className="toast-dot"></span>
          <span>{toast.msg}</span>
          <button
            className="toast-action"
            onClick={() => {
              const kind = toast.actionKind;
              setToast(null);
              if (kind === "orphans") {
                setMode("threads");
              } else if (kind === "split") {
                // Navigate to Today and open the split/estimate panel for the active focus task
                setPendingAction({
                  kind: "split",
                  taskText: focus.task ?? undefined,
                });
                setMode("today");
              } else if (kind === "redefine") {
                setPendingAction({
                  kind: "redefine",
                  taskText: focus.task ?? undefined,
                });
                setMode("today");
              }
            }}
          >
            {toast.action}
          </button>
          {toast.action2 && (
            <button
              className="toast-action muted"
              onClick={() => {
                const kind2 = toast.action2Kind;
                if (kind2 === "redefine") {
                  setPendingAction({
                    kind: "redefine",
                    taskText: focus.task ?? undefined,
                  });
                  setToast(null);
                  setMode("today");
                } else if (kind2 === "dismiss") {
                  if (toast.rule) dismissRule(toast.rule);
                  setToast(null);
                } else {
                  setToast(null);
                }
              }}
            >
              {toast.action2}
            </button>
          )}
          <button
            className="toast-action muted"
            onClick={() => {
              if (toast.rule) dismissRule(toast.rule);
              setToast(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
