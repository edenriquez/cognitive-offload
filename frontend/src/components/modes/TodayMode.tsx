import { useState } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import Ring from "../shared/Ring";

export default function TodayMode() {
  const { tasks, setTasks, toggleTask, bandwidth, startFocus, now, signals } =
    useAppStore();
  const [revealBw, setRevealBw] = useState(false);
  const [revealCtx, setRevealCtx] = useState(false);

  const hour = now.getHours() + now.getMinutes() / 60;
  const greet =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const nextTask = tasks.find(
    (t) => !t.done && (t.kind === "must" || t.kind === "personal"),
  );
  const total =
    bandwidth.work + bandwidth.personal + bandwidth.admin + bandwidth.learning;

  const activeThread = signals?.active_session;
  const warnIntervention = signals?.interventions.find(
    (i) => i.severity === "warn",
  );

  const handleToggle = async (id: string) => {
    toggleTask(id); // optimistic
    try {
      await api.toggleTask(id);
    } catch {
      toggleTask(id); // revert
    }
  };

  const handleFocus = (task: string) => {
    const t = tasks.find((t) => t.text === task);
    if (t) api.startFocus(t.id).catch(() => {});
    startFocus(task);
  };

  return (
    <div className="today">
      <div className="today-inner">
        {/* Thread gravity card — dynamic from signals */}
        {activeThread && (
          <div className="gravity">
            <div>
              <div className="gravity-eye">
                Active thread · {activeThread.duration_min}m open
              </div>
              <div className="gravity-task">{activeThread.label}</div>
              <div className="gravity-meta">
                last touch {activeThread.last_touch_ago_sec}s ago
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={() => handleFocus(activeThread.label)}
            >
              Resume →
            </button>
          </div>
        )}

        {/* Inline guidance ribbon — dynamic from interventions */}
        {warnIntervention && (
          <div className="ribbon danger">
            <span className="pulse-dot"></span>
            <span>
              <b>{warnIntervention.title}.</b> {warnIntervention.body}
            </span>
            {activeThread && (
              <span
                className="ribbon-redirect"
                onClick={() => handleFocus(activeThread.label)}
              >
                Continue current thread →
              </span>
            )}
          </div>
        )}

        <div className="today-greet">{greet} · day 14</div>
        <div className="today-q">
          The one thing right now is{" "}
          <em>
            {nextTask ? nextTask.text.toLowerCase() : "rest. you're done."}
          </em>
        </div>

        <div className="ttasks">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`ttask ${t.done ? "done" : ""} ${t.id === nextTask?.id ? "active" : ""}`}
            >
              <span className={`ttask-rank ${t.kind}`}>
                {t.kind === "must"
                  ? `Must ${t.idx}`
                  : t.kind === "personal"
                    ? "Personal"
                    : "Small"}
              </span>
              <div className="ttask-text">{t.text}</div>
              {t.id === nextTask?.id && !t.done ? (
                <button
                  className="ttask-go"
                  onClick={() => handleFocus(t.text)}
                >
                  Focus
                </button>
              ) : (
                <span
                  className="ttask-check"
                  onClick={() => handleToggle(t.id)}
                ></span>
              )}
            </div>
          ))}
        </div>

        <div className="reveal-row">
          <button
            className={`reveal-pill ${revealBw ? "on" : ""}`}
            onClick={() => setRevealBw((b) => !b)}
          >
            {revealBw ? "Hide bandwidth" : "Show bandwidth"}
          </button>
          <button
            className={`reveal-pill ${revealCtx ? "on" : ""}`}
            onClick={() => setRevealCtx((b) => !b)}
          >
            {revealCtx ? "Hide context" : "Show context"}
          </button>
        </div>

        <div className={`reveal-content ${revealBw ? "on" : ""}`}>
          <div className="ring-row">
            <Ring alloc={bandwidth} />
            <div className="ring-legend">
              <span>
                <i style={{ background: "#1c1d1f" }}></i>Work core
              </span>
              <b>{bandwidth.work}%</b>
              <span>
                <i style={{ background: "#407ff2" }}></i>Personal
              </span>
              <b>{bandwidth.personal}%</b>
              <span>
                <i style={{ background: "#8f99a8" }}></i>Admin
              </span>
              <b>{bandwidth.admin}%</b>
              <span>
                <i style={{ background: "#d3d8df" }}></i>Learning
              </span>
              <b>{bandwidth.learning}%</b>
            </div>
          </div>
          <div className="ctx-line">
            Allocated · {total}% &nbsp;·&nbsp; Cutoff · 16:30 &nbsp;·&nbsp;
            Productive · 6h
          </div>
        </div>

        <div className={`reveal-content ${revealCtx ? "on" : ""}`}>
          <div
            className="ctx-line"
            style={{
              textAlign: "left",
              padding: "0 8px",
              lineHeight: 1.7,
              fontSize: 13,
            }}
          >
            {tasks
              .filter((t) => t.kind === "must")
              .map((t, i) => (
                <span key={t.id}>
                  Must {i + 1} → {t.text}
                  <br />
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
