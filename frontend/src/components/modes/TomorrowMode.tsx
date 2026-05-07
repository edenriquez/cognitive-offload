import { useState, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import type { Plan } from "../../types";

const RULE_ICONS: Record<string, string> = {
  CUTOFF: "🛑",
  THREAD_CAP: "🔒",
  RECOVERY: "🌿",
  CHECKPOINT: "📌",
  CLOSE_LOOPS: "🧹",
  FOCUS_BLOCK: "🎯",
  CONTINUE: "▶️",
  PREFLIGHT: "🔧",
};

export default function TomorrowMode() {
  const setMode = useAppStore((s) => s.setMode);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTomorrow()
      .then((data) => {
        if (data) setPlan(data);
      })
      .catch((err) => setError(err?.message ?? "Failed to load plan"))
      .finally(() => setLoading(false));
  }, []);

  const handleLock = async () => {
    try {
      const locked = await api.lockTomorrow();
      if (locked) setPlan(locked);
    } catch {}
  };

  if (loading) {
    return (
      <div className="tomorrow">
        <div className="tomorrow-inner">
          <div className="tom-h">Loading...</div>
        </div>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="tomorrow">
        <div className="tomorrow-inner">
          <div className="tom-h">No plan generated yet</div>
          <h1 className="tom-headline">
            {error ?? "Work today to auto-generate tomorrow's plan."}
          </h1>
          <div className="tom-cta">
            <button className="btn-secondary" onClick={() => setMode("today")}>
              Back to today
            </button>
          </div>
        </div>
      </div>
    );
  }

  let dayLabel = "Tomorrow";
  try {
    if (plan.day) {
      dayLabel = new Date(plan.day + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
  } catch {
    dayLabel = plan.day ?? "Tomorrow";
  }

  const constraints = plan.constraints ?? [];
  const tasks = plan.tasks ?? [];
  const headline = plan.headline ?? "Your plan for tomorrow";

  return (
    <div className="tomorrow">
      <div className="tomorrow-inner">
        <div className="tom-h">
          {dayLabel} · auto-generated
          {plan.status === "locked" ? " · locked ✓" : ""}
        </div>
        <h1 className="tom-headline">{headline}</h1>

        {/* Constraints — enforced rules */}
        {constraints.length > 0 && (
          <div className="tom-constraints">
            <div className="tom-section-label">Constraints · enforced</div>
            {constraints.map((c, i) => (
              <div key={i} className="tom-constraint">
                <div className="tom-constraint-icon">
                  {RULE_ICONS[c.rule] ?? "⌷"}
                </div>
                <div className="tom-constraint-body">
                  <div className="tom-constraint-title">{c.title ?? ""}</div>
                  <div className="tom-constraint-desc">
                    {c.description ?? ""}
                  </div>
                </div>
                {c.locked && <div className="tom-constraint-lock">locked</div>}
              </div>
            ))}
          </div>
        )}

        {/* Bandwidth */}
        {plan.bandwidth && (
          <div className="tom-bandwidth">
            <div className="tom-section-label">Bandwidth · adjusted</div>
            <div className="tom-bw-bars">
              <div className="tom-bw-row">
                <span className="tom-bw-cat">Work</span>
                <div className="tom-bw-track">
                  <span
                    className="tom-bw-fill"
                    style={{
                      width: `${plan.bandwidth.work}%`,
                      background: "var(--color-ink)",
                    }}
                  ></span>
                </div>
                <span className="tom-bw-pct">{plan.bandwidth.work}%</span>
              </div>
              <div className="tom-bw-row">
                <span className="tom-bw-cat">Personal</span>
                <div className="tom-bw-track">
                  <span
                    className="tom-bw-fill"
                    style={{
                      width: `${plan.bandwidth.personal}%`,
                      background: "var(--color-action-blue)",
                    }}
                  ></span>
                </div>
                <span className="tom-bw-pct">{plan.bandwidth.personal}%</span>
              </div>
              <div className="tom-bw-row">
                <span className="tom-bw-cat">Admin</span>
                <div className="tom-bw-track">
                  <span
                    className="tom-bw-fill"
                    style={{
                      width: `${plan.bandwidth.admin}%`,
                      background: "var(--color-overcast)",
                    }}
                  ></span>
                </div>
                <span className="tom-bw-pct">{plan.bandwidth.admin}%</span>
              </div>
              <div className="tom-bw-row">
                <span className="tom-bw-cat">Learning</span>
                <div className="tom-bw-track">
                  <span
                    className="tom-bw-fill"
                    style={{
                      width: `${plan.bandwidth.learning}%`,
                      background: "var(--color-slate)",
                    }}
                  ></span>
                </div>
                <span className="tom-bw-pct">{plan.bandwidth.learning}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Tasks */}
        {tasks.length > 0 ? (
          <>
            <div className="tom-section-label" style={{ marginTop: 32 }}>
              Tasks · pre-selected
            </div>
            <div className="tom-list">
              {tasks.map((t, i) => (
                <div key={t.id ?? i} className="tom-item">
                  <span className={`tom-rank ${i === 0 ? "locked" : ""}`}>
                    {String(i + 1).padStart(2, "0")}
                    {i === 0 ? " ◆" : ""}
                  </span>
                  <div>
                    <div className="tom-task">{t.text ?? ""}</div>
                    <div className="tom-meta">
                      {t.kind === "personal" ? "protected window · " : ""}
                      {t.kind ?? "must"} task
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-overcast)",
              padding: "32px 0",
            }}
          >
            No tasks pre-selected yet.
          </div>
        )}

        <div className="tom-cta">
          <button className="btn-secondary" onClick={() => setMode("today")}>
            Back to today
          </button>
          {plan.status !== "locked" && (
            <button className="btn-primary" onClick={handleLock}>
              Lock in plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
