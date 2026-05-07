import { useState, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import type { Plan } from "../../types";

function RuleIcon({ rule }: { rule: string }) {
  const s = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (rule) {
    case "CUTOFF": // clock with slash
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6" />
          <path d="M4 4l16 16" />
        </svg>
      );
    case "CONTEXT_SWITCH": // converging arrows — reduce switching
      return (
        <svg {...s}>
          <path d="M8 3v4l-4 4 4 4v4" />
          <path d="M16 3v4l4 4-4 4v4" />
        </svg>
      );
    case "RECOVERY": // heart pulse
      return (
        <svg {...s}>
          <path d="M3 12h4l3-6 4 12 3-6h4" />
        </svg>
      );
    case "CHECKPOINT": // flag
      return (
        <svg {...s}>
          <path d="M4 21V4" />
          <path d="M4 4l12 4-12 4" />
        </svg>
      );
    case "CLOSE_LOOPS": // circle with check
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "FOCUS_BLOCK": // crosshair
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      );
    case "CONTINUE": // play
      return (
        <svg {...s}>
          <polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none" />
        </svg>
      );
    case "PREFLIGHT": // wrench
      return (
        <svg {...s}>
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94L6.7 20.2a2.12 2.12 0 01-3-3l6.73-6.73a6 6 0 017.94-7.94z" />
        </svg>
      );
    default:
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4l2 2" />
        </svg>
      );
  }
}

export default function TomorrowMode() {
  const setMode = useAppStore((s) => s.setMode);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const fetchPlan = () => {
    setLoading(true);
    api
      .getTomorrow()
      .then((data) => {
        if (data) setPlan(data);
      })
      .catch((err) => setError(err?.message ?? "Failed to load plan"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPlan();
  }, []);

  const handleLock = async () => {
    try {
      const locked = await api.lockTomorrow();
      if (locked) setPlan(locked);
      setActionMsg("Plan locked ✓");
      setTimeout(() => setActionMsg(null), 3000);
    } catch {}
  };

  const handleRegenerate = async () => {
    setActionMsg(null);
    try {
      const fresh = await api.regenerateTomorrow();
      if (fresh) setPlan(fresh);
      setActionMsg("Plan regenerated from today's data ✓");
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err: any) {
      setActionMsg(
        err?.message?.includes("locked")
          ? "Cannot regenerate — plan is locked"
          : "No data to generate from yet",
      );
      setTimeout(() => setActionMsg(null), 4000);
    }
  };

  const handleRollover = async () => {
    setActionMsg(null);
    try {
      const result = await api.rolloverTomorrow();
      setActionMsg(
        `Rolled over ${result.tasks_created} tasks into ${result.day} ✓`,
      );
      setTimeout(() => setActionMsg(null), 4000);
      fetchPlan(); // refresh to show completed status
    } catch {
      setActionMsg("Rollover failed");
      setTimeout(() => setActionMsg(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="tomorrow">
        <div className="tomorrow-inner">
          <div className="tom-skeleton">
            {/* Headline placeholder */}
            <div
              className="skeleton-block"
              style={{ width: "40%", height: 14, marginBottom: 12 }}
            />
            <div
              className="skeleton-block"
              style={{ width: "75%", height: 24, marginBottom: 32 }}
            />

            {/* Task row skeletons */}
            <div
              className="skeleton-block"
              style={{ width: 120, height: 12, marginBottom: 16 }}
            />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="skeleton-row"
                style={{
                  marginBottom: 12,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--color-stone)",
                }}
              >
                <div
                  className="skeleton-block"
                  style={{ width: 32, height: 14 }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    className="skeleton-block"
                    style={{ width: "70%", height: 14, marginBottom: 6 }}
                  />
                  <div
                    className="skeleton-block"
                    style={{ width: "40%", height: 11 }}
                  />
                </div>
              </div>
            ))}

            {/* Constraint card skeletons */}
            <div
              className="skeleton-block"
              style={{
                width: 140,
                height: 12,
                marginTop: 32,
                marginBottom: 16,
              }}
            />
            {[1, 2].map((i) => (
              <div
                key={i}
                className="skeleton-row"
                style={{
                  marginBottom: 12,
                  padding: "14px 0",
                  borderBottom: "1px solid var(--color-stone)",
                }}
              >
                <div className="skeleton-circle" />
                <div style={{ flex: 1 }}>
                  <div
                    className="skeleton-block"
                    style={{ width: "50%", height: 14, marginBottom: 6 }}
                  />
                  <div
                    className="skeleton-block"
                    style={{ width: "80%", height: 11 }}
                  />
                </div>
              </div>
            ))}

            {/* Bandwidth bar skeleton */}
            <div
              className="skeleton-block"
              style={{
                width: 130,
                height: 12,
                marginTop: 32,
                marginBottom: 16,
              }}
            />
            <div
              className="skeleton-block"
              style={{
                width: "100%",
                height: 56,
                borderRadius: "var(--radius-cards)",
              }}
            />
          </div>
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

        {/* Actions — top */}
        <div className="tom-cta">
          <button className="btn-secondary" onClick={() => setMode("today")}>
            Back to today
          </button>
          <button className="btn-secondary" onClick={handleRegenerate}>
            Regenerate plan
          </button>
          {plan.status !== "locked" && plan.status !== "completed" && (
            <button className="btn-primary" onClick={handleLock}>
              Lock in plan
            </button>
          )}
          {(plan.status === "locked" || plan.status === "draft") &&
            tasks.length > 0 && (
              <button className="btn-primary" onClick={handleRollover}>
                Roll over tasks now
              </button>
            )}
        </div>
        {actionMsg && <div className="tom-action-msg">{actionMsg}</div>}
        {plan.status === "completed" && (
          <div className="tom-completed-msg">
            Plan completed — tasks have been rolled into your Today tab.
          </div>
        )}

        {/* 1. Tasks */}
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

        {/* 2. Bandwidth */}
        {plan.bandwidth && (
          <div className="tom-bandwidth" style={{ marginTop: 32 }}>
            <div className="tom-section-label">Bandwidth · adjusted</div>
            <div className="tom-bw-bars">
              {[
                {
                  cat: "Work",
                  val: plan.bandwidth.work,
                  color: "var(--color-ink)",
                },
                {
                  cat: "Personal",
                  val: plan.bandwidth.personal,
                  color: "var(--color-action-blue)",
                },
                {
                  cat: "Admin",
                  val: plan.bandwidth.admin,
                  color: "var(--color-overcast)",
                },
                {
                  cat: "Learning",
                  val: plan.bandwidth.learning,
                  color: "var(--color-slate)",
                },
              ].map((b) => (
                <div key={b.cat} className="tom-bw-row">
                  <span className="tom-bw-cat">{b.cat}</span>
                  <div className="tom-bw-track">
                    <span
                      className="tom-bw-fill"
                      style={{ width: `${b.val}%`, background: b.color }}
                    ></span>
                  </div>
                  <span className="tom-bw-pct">{b.val}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Constraints */}
        {constraints.length > 0 && (
          <div className="tom-constraints" style={{ marginTop: 32 }}>
            <div className="tom-section-label">Constraints · enforced</div>
            {constraints.map((c, i) => (
              <div key={i} className="tom-constraint">
                <div className="tom-constraint-icon">
                  <RuleIcon rule={c.rule} />
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
      </div>
    </div>
  );
}
