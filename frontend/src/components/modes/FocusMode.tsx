import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";

interface Props {
  task: string;
  onExit: () => void;
}

export default function FocusMode({ task, onExit }: Props) {
  const [secs, setSecs] = useState(90 * 60);
  const [showWhy, setShowWhy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    document.body.classList.add("in-focus");

    const t = setInterval(() => {
      if (mountedRef.current) {
        setSecs((s) => Math.max(0, s - 1));
      }
    }, 1000);

    return () => {
      mountedRef.current = false;
      clearInterval(t);
      document.body.classList.remove("in-focus");
    };
  }, []);

  const elapsed = 90 * 60 - secs;
  const progressPct = Math.min(100, (elapsed / (90 * 60)) * 100);
  const m = Math.floor(secs / 60);
  const s = secs % 60;

  const handleExit = useCallback(
    (outcome: string) => {
      // Fire-and-forget — never let API errors block exit
      try {
        api.stopFocus(outcome).catch(() => {});
      } catch {
        // ignore
      }
      onExit();
    },
    [onExit],
  );

  return (
    <div className="focus">
      <div className="focus-inner">
        <div className="focus-eye">Focus · 90-minute block</div>
        <div className="focus-task">{task || "Pick a task"}</div>
        <div className="focus-timer">
          {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
        </div>
        <div className="focus-meta">remaining of 90-minute block</div>
        <div className="focus-progress">
          <span style={{ width: `${progressPct}%` }}></span>
        </div>
        <div className="focus-actions">
          <button
            className="btn-secondary"
            onClick={() => handleExit("paused")}
          >
            Pause
          </button>
          <button className="btn-primary" onClick={() => handleExit("done")}>
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
