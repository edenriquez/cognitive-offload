import { useState } from "react";
import type { Pattern } from "../../types";

// Static explanation copy per pattern kind
const PATTERN_EXPLANATIONS: Record<string, { meaning: string; cost: string; commitment: string }> = {
  "perf-degradation": {
    meaning: "You were thrashing — opening new threads before finishing the current one. Each switch fragments your attention and resets your working context.",
    cost: "Each context switch costs roughly 8 minutes of recovery time to regain focus. 5 switches in 30 minutes means up to 40 minutes of invisible lost output.",
    commitment: "Finish the current thread before opening a new one.",
  },
  crash: {
    meaning: "Your activity dropped sharply after lunch and never recovered to morning levels. The post-lunch window became a low-output drift period.",
    cost: "A 40%+ activity drop for 2 hours is roughly 45 minutes of effective work lost — even if you were technically at the keyboard.",
    commitment: "Plan a 10-minute walk or a light task buffer at 1 PM to reset energy instead of drifting.",
  },
  fatigue: {
    meaning: "You worked past your cognitive cutoff with your error rate rising. The errors weren't random — they were a signal that quality was degrading.",
    cost: "Errors created past cognitive limits compound. You may spend more time tomorrow debugging what you wrote tonight than the work was worth.",
    commitment: "Stop new complex work 30 minutes before your cutoff. Use the last window to close loops only.",
  },
  stuck: {
    meaning: "A thread stayed open for over 90 minutes with very few messages. This is often a stuck problem — not making progress, not closing it either.",
    cost: "An unresolved thread occupies working memory even when you're not actively in it. It creates background cognitive load that dulls focus on everything else.",
    commitment: "If a thread exceeds 90 minutes with under 20 messages, close it and reformulate the problem from scratch.",
  },
  "open-loops": {
    meaning: "Multiple threads were left open without resolution. Open loops are cognitive residue — your mind keeps returning to them.",
    cost: "Each unresolved loop consumes roughly 4% of available working memory. Three open loops means ~12% of your focus is permanently occupied until they're closed.",
    commitment: "End each session by either closing the thread or writing the next concrete action into it.",
  },
  overwork: {
    meaning: "You exceeded your planned work allocation. The boundary you set didn't hold.",
    cost: "Consistent overwork raises your baseline fatigue level. Each day you exceed your limit, the next day starts slightly behind.",
    commitment: "When you hit your planned cutoff, stop and move remaining work to tomorrow rather than extending.",
  },
};

const DEFAULT_EXPLANATION = {
  meaning: "This pattern was detected in your activity data.",
  cost: "Repeated patterns accumulate and compound over time.",
  commitment: "Review what happened in this window and adjust tomorrow.",
};

// Pattern kind icons (SVG, no emojis)
function PatternIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "perf-degradation":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12l4-5 3 3 5-7" />
        </svg>
      );
    case "crash":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4l4 5 3-2 5 6" />
        </svg>
      );
    case "fatigue":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 2" />
        </svg>
      );
    case "stuck":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
          <path d="M8 6v2M8 10h.01" />
        </svg>
      );
    case "open-loops":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0" />
          <path d="M8 5V2M8 14v-3M5 8H2M14 8h-3" />
        </svg>
      );
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v5l3 3" />
          <circle cx="8" cy="8" r="6" />
        </svg>
      );
  }
}

interface SignalCardProps {
  pattern: Pattern;
  onAcknowledge: (id: string, commitment: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}

export default function SignalCard({ pattern, onAcknowledge, onDismiss }: SignalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<"acknowledged" | "dismissed" | null>(
    pattern.acknowledged ? "acknowledged" : pattern.dismissed ? "dismissed" : null
  );

  const explanation = PATTERN_EXPLANATIONS[pattern.kind] ?? DEFAULT_EXPLANATION;
  const isHigh = pattern.severity === "high";

  const handleAcknowledge = async () => {
    setActing(true);
    await onAcknowledge(pattern.id, explanation.commitment);
    setDone("acknowledged");
    setActing(false);
  };

  const handleDismiss = async () => {
    setActing(true);
    await onDismiss(pattern.id);
    setDone("dismissed");
    setActing(false);
  };

  if (done === "dismissed") {
    return (
      <div className="signal-card signal-card--dismissed">
        <span className="signal-card-dismissed-label">Dismissed — {pattern.title}</span>
      </div>
    );
  }

  if (done === "acknowledged") {
    return (
      <div className="signal-card signal-card--acknowledged">
        <span className="signal-card-ack-icon">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l4 4 6-7" />
          </svg>
        </span>
        <div>
          <span className="signal-card-ack-label">{pattern.title}</span>
          <span className="signal-card-ack-commit">Committed: "{explanation.commitment}"</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`signal-card${isHigh ? " signal-card--high" : ""}${expanded ? " signal-card--open" : ""}`}>
      {/* Header row — always visible */}
      <button className="signal-card-header" onClick={() => setExpanded(v => !v)}>
        <span className={`signal-card-icon${isHigh ? " signal-card-icon--high" : ""}`}>
          <PatternIcon kind={pattern.kind} />
        </span>
        <div className="signal-card-header-body">
          <span className="signal-card-title">{pattern.title}</span>
          <span className="signal-card-meta">
            <span className={`signal-card-sev signal-card-sev--${pattern.severity}`}>{pattern.severity}</span>
            {pattern.window && <span className="signal-card-window">{pattern.window}</span>}
          </span>
        </div>
        <span className="signal-card-chevron">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? <path d="M4 10l4-4 4 4" /> : <path d="M4 6l4 4 4-4" />}
          </svg>
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="signal-card-body">
          {pattern.detail && (
            <p className="signal-card-detail">{pattern.detail}</p>
          )}

          <div className="signal-card-section">
            <span className="signal-card-section-label">What this means</span>
            <p className="signal-card-section-text">{explanation.meaning}</p>
          </div>

          <div className="signal-card-section">
            <span className="signal-card-section-label">The actual cost</span>
            <p className="signal-card-section-text">{explanation.cost}</p>
          </div>

          <div className="signal-card-actions">
            <button
              className="signal-card-btn signal-card-btn--primary"
              onClick={handleAcknowledge}
              disabled={acting}
            >
              Acknowledge — I'll fix this
            </button>
            <button
              className="signal-card-btn signal-card-btn--ghost"
              onClick={handleDismiss}
              disabled={acting}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
