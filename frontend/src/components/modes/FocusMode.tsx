import { useState, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";

export default function FocusMode() {
  const { focus, pauseFocus, exitFocus, tasks, toggleTask } = useAppStore();
  const [showWhy, setShowWhy] = useState(false);

  // Body class for focus-specific styles
  useEffect(() => {
    document.body.classList.add("in-focus");
    return () => document.body.classList.remove("in-focus");
  }, []);

  const totalSecs = 90 * 60;
  const remaining = focus.remainingSecs;
  const elapsed = totalSecs - remaining;
  const progressPct = Math.min(100, (elapsed / totalSecs) * 100);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;

  const handlePause = () => {
    try {
      api.stopFocus("paused").catch(() => {});
    } catch {
      /* ignore */
    }
    pauseFocus();
  };

  const handleDone = () => {
    // Stop the focus session
    try {
      api.stopFocus("done").catch(() => {});
    } catch {
      /* ignore */
    }

    // Mark the task as done in the task list
    const task = tasks.find((t) => t.text === focus.task && !t.done);
    if (task) {
      toggleTask(task.id);
      api.toggleTask(task.id).catch(() => {});
    }

    exitFocus("done");
  };

  return (
    <div className="focus">
      <div className="focus-inner">
        <div className="focus-eye">Focus · 90-minute block</div>
        <div className="focus-task">{focus.task || "Pick a task"}</div>
        <div className="focus-timer">
          {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
        </div>
        <div className="focus-meta">remaining of 90-minute block</div>
        <div className="focus-progress">
          <span style={{ width: `${progressPct}%` }}></span>
        </div>
        <div className="focus-actions">
          <button className="btn-secondary" onClick={handlePause}>
            Pause
          </button>
          <button className="btn-primary" onClick={handleDone}>
            Done
          </button>
        </div>
        <span className="focus-reveal" onClick={() => setShowWhy((v) => !v)}>
          {showWhy ? "hide context" : "why this task"}
        </span>
        {showWhy && (
          <div className="focus-why">
            Tied to roadmap goal <b>auth-success 87% → 92%</b>. Estimated impact{" "}
            <span className="blue">+8%</span>. Continues yesterday's open
            thread.
          </div>
        )}
      </div>
    </div>
  );
}
