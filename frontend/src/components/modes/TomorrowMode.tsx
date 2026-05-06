import { useState, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import type { Plan } from "../../types";

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
            {error ?? "Start the backend to generate tomorrow's plan."}
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

        {constraints.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            {constraints.map((c, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  color: "var(--color-metal)",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--color-stone)",
                }}
              >
                {c.locked && (
                  <span
                    style={{
                      color: "var(--color-action-blue)",
                      marginRight: 8,
                    }}
                  >
                    ⌷
                  </span>
                )}
                <b style={{ color: "var(--color-ink)" }}>{c.title ?? ""}</b>{" "}
                <span>{c.description ?? ""}</span>
              </div>
            ))}
          </div>
        )}

        {tasks.length > 0 ? (
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
