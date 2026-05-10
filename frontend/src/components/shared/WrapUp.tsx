import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import type { ReviewSummary, SessionScore } from "../../types";

interface WrapUpProps {
  day: string;
  onClose: () => void;
}

interface AnalysisData {
  source: string;
  headline?: string;
  analysis: { title: string; content: string }[];
  suggestions: { title: string; detail: string; metric: string }[];
  cognitive_score?: number;
  productivity_rating?: string;
}

function formatDayLabel(day: string): string {
  const d = new Date(day + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function fmtMin(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function WrapUp({ day, onClose }: WrapUpProps) {
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [scores, setScores] = useState<SessionScore[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);

  // Determine total slide count based on loaded data
  const totalSlides =
    analysis?.suggestions && analysis.suggestions.length > 0 ? 6 : 5;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const results = await Promise.allSettled([
        api.getReview(day),
        api.getSessionScores(day),
        api.analyzeDay(day),
      ]);

      if (cancelled) return;

      if (results[0].status === "fulfilled") setReview(results[0].value);
      if (results[1].status === "fulfilled") setScores(results[1].value);
      if (results[2].status === "fulfilled") {
        setAnalysis(results[2].value);
      } else {
        // Provide a template fallback
        setAnalysis({
          source: "template",
          headline: "Daily Summary",
          analysis: [
            {
              title: "Overview",
              content: "Analysis unavailable — showing template report.",
            },
          ],
          suggestions: [],
        });
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [day]);

  const go = useCallback(
    (dir: number) => {
      setSlide((s) => {
        const next = s + dir;
        if (next < 0 || next >= totalSlides) return s;
        return next;
      });
    },
    [totalSlides],
  );

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const summary = review?.summary ?? {
    deep_work_min: 0,
    leaked_min: 0,
    open_loops: 0,
    sessions_count: 0,
  };

  const sessionsList = review?.sessions ?? [];
  const selfReports = review?.self_reports ?? [];

  function slideClass(idx: number): string {
    if (idx === slide) return "wrapup-slide active";
    if (idx < slide) return "wrapup-slide prev";
    return "wrapup-slide next";
  }

  // Session score helpers
  const highLeverage = scores.filter((s) => s.output_score >= 60).length;
  const lowOutput = scores.filter((s) => s.output_score < 30).length;

  function scoreColor(score: number): string {
    if (score >= 60) return "high";
    if (score >= 30) return "mid";
    return "low";
  }

  function scoreFillColor(score: number): string {
    if (score >= 60) return "var(--color-success-green)";
    if (score >= 30) return "var(--color-warning-yellow)";
    return "var(--color-danger-red)";
  }

  // Energy arc summary
  const energyBuckets = review?.energy_map ?? [];
  const peakBucket = energyBuckets.reduce(
    (max, b) => (b.activity > (max?.activity ?? 0) ? b : max),
    energyBuckets[0] ?? null,
  );
  const lowBucket = energyBuckets.reduce(
    (min, b) => (b.activity < (min?.activity ?? Infinity) ? b : min),
    energyBuckets[0] ?? null,
  );

  const patterns = review?.patterns ?? [];
  const wallPattern = patterns.find(
    (p) => p.kind === "stuck" || p.kind === "fatigue",
  );

  return (
    <div className="wrapup-overlay">
      {/* Header */}
      <div className="wrapup-header">
        <div className="wrapup-day">{formatDayLabel(day)}</div>
        <button className="wrapup-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {/* Body */}
      <div className="wrapup-body">
        {loading ? (
          <div className="wrapup-loading">
            <div style={{ fontSize: 28, marginBottom: 4 }}>◐</div>
            Loading day data…
          </div>
        ) : (
          <>
            {/* Slide 1 — Overview */}
            <div className={slideClass(0)}>
              <div className="wrapup-slide-inner">
                <div className="wrapup-slide-title">{formatDayLabel(day)}</div>
                <div className="wrapup-slide-subtitle">
                  Here's how your day shaped up.
                </div>
                <div className="wrapup-metrics">
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {fmtMin(summary.deep_work_min)}
                    </div>
                    <div className="wrapup-metric-label">Deep work</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {fmtMin(summary.leaked_min)}
                    </div>
                    <div className="wrapup-metric-label">Leaked time</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {summary.sessions_count}
                    </div>
                    <div className="wrapup-metric-label">Sessions</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {analysis?.cognitive_score ?? "—"}
                    </div>
                    <div className="wrapup-metric-label">Cognitive score</div>
                  </div>
                </div>
                {analysis?.productivity_rating && (
                  <div className="wrapup-slide-subtitle">
                    Productivity:{" "}
                    <strong>{analysis.productivity_rating}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Slide 2 — AI Analysis */}
            <div className={slideClass(1)}>
              <div className="wrapup-slide-inner">
                <div className="wrapup-slide-title">
                  {analysis?.headline ?? "Day Analysis"}
                </div>
                <span className="wrapup-source-badge">
                  source: {analysis?.source ?? "template"}
                </span>
                {(analysis?.analysis ?? []).length === 0 ? (
                  <div className="wrapup-slide-subtitle">
                    No analysis sections available for this day.
                  </div>
                ) : (
                  (analysis?.analysis ?? []).map((sec, i) => (
                    <div key={i} className="wrapup-analysis-card">
                      <div className="wrapup-analysis-title">{sec.title}</div>
                      <div className="wrapup-analysis-content">
                        {sec.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Slide 3 — Session Breakdown */}
            <div className={slideClass(2)}>
              <div className="wrapup-slide-inner">
                <div className="wrapup-slide-title">Session Breakdown</div>
                <div className="wrapup-slide-subtitle">
                  {sessionsList.length} total session
                  {sessionsList.length !== 1 ? "s" : ""}
                  {highLeverage > 0 && (
                    <>
                      {" "}
                      · <strong>{highLeverage}</strong> high-leverage
                    </>
                  )}
                  {lowOutput > 0 && (
                    <>
                      {" "}
                      · <strong>{lowOutput}</strong> low-output
                    </>
                  )}
                </div>
                <div className="wrapup-sessions-list">
                  {sessionsList.length === 0 ? (
                    <div className="wrapup-slide-subtitle">
                      No sessions recorded.
                    </div>
                  ) : (
                    sessionsList.slice(0, 10).map((s) => {
                      const sc = scores.find((x) => x.session_id === s.id);
                      const score = sc?.output_score ?? -1;
                      return (
                        <div key={s.id} className="wrapup-session-row">
                          <span className="wrapup-session-label">
                            {s.label}
                          </span>
                          <div className="wrapup-session-bar">
                            <div
                              className="wrapup-session-bar-fill"
                              style={{
                                width: `${score >= 0 ? score : 0}%`,
                                background:
                                  score >= 0
                                    ? scoreFillColor(score)
                                    : "var(--color-stone)",
                              }}
                            />
                          </div>
                          <span
                            className={`wrapup-session-score ${score >= 0 ? scoreColor(score) : ""}`}
                          >
                            {score >= 0 ? score : "—"}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Slide 4 — Energy Arc */}
            <div className={slideClass(3)}>
              <div className="wrapup-slide-inner">
                <div className="wrapup-slide-title">Energy Arc</div>
                <div className="wrapup-slide-subtitle">
                  Your energy pattern throughout the day.
                </div>
                <div className="wrapup-metrics">
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {peakBucket ? `${peakBucket.hour}:00` : "—"}
                    </div>
                    <div className="wrapup-metric-label">Peak hour</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {lowBucket ? `${lowBucket.hour}:00` : "—"}
                    </div>
                    <div className="wrapup-metric-label">Low point</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {wallPattern ? wallPattern.window : "None"}
                    </div>
                    <div className="wrapup-metric-label">Wall time</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {selfReports.length}
                    </div>
                    <div className="wrapup-metric-label">Self reports</div>
                  </div>
                </div>
                {energyBuckets.length === 0 && (
                  <div className="wrapup-slide-subtitle">
                    No energy data recorded for this day.
                  </div>
                )}
              </div>
            </div>

            {/* Slide 5 — Suggestions (only if we have them) */}
            {analysis?.suggestions && analysis.suggestions.length > 0 && (
              <div className={slideClass(4)}>
                <div className="wrapup-slide-inner">
                  <div className="wrapup-slide-title">Suggestions</div>
                  <div className="wrapup-slide-subtitle">
                    Actionable changes for tomorrow.
                  </div>
                  {analysis.suggestions.slice(0, 3).map((s, i) => (
                    <div key={i} className="wrapup-suggestion-card">
                      <div className="wrapup-suggestion-num">{i + 1}</div>
                      <div>
                        <div className="wrapup-suggestion-title">{s.title}</div>
                        <div className="wrapup-suggestion-detail">
                          {s.detail}
                        </div>
                        <div className="wrapup-suggestion-metric">
                          📏 {s.metric}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Last Slide — Closing */}
            <div className={slideClass(totalSlides - 1)}>
              <div className="wrapup-slide-inner">
                <div className="wrapup-slide-title">Ready for tomorrow</div>
                <div className="wrapup-slide-subtitle">
                  {summary.deep_work_min > 0
                    ? `You logged ${fmtMin(summary.deep_work_min)} of deep work across ${summary.sessions_count} session${summary.sessions_count !== 1 ? "s" : ""}. `
                    : "No deep work logged today. "}
                  {summary.leaked_min > 0
                    ? `${fmtMin(summary.leaked_min)} of time leaked.`
                    : "No time leaked — clean day!"}
                </div>
                <div
                  className="wrapup-metrics"
                  style={{ maxWidth: 320, margin: "0 auto" }}
                >
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {summary.open_loops}
                    </div>
                    <div className="wrapup-metric-label">Open loops</div>
                  </div>
                  <div className="wrapup-metric">
                    <div className="wrapup-metric-value">
                      {patterns.length}
                    </div>
                    <div className="wrapup-metric-label">Patterns flagged</div>
                  </div>
                </div>
                <div
                  className="wrapup-slide-subtitle"
                  style={{ marginTop: 24 }}
                >
                  Close this wrap-up and plan ahead.
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer navigation */}
      {!loading && (
        <div className="wrapup-footer">
          <button
            className="wrapup-nav-btn"
            onClick={() => go(-1)}
            disabled={slide === 0}
            aria-label="Previous slide"
          >
            ‹
          </button>
          <div className="wrapup-dots">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <div
                key={i}
                className={`wrapup-dot${i === slide ? " active" : ""}`}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
          <button
            className="wrapup-nav-btn"
            onClick={() => go(1)}
            disabled={slide === totalSlides - 1}
            aria-label="Next slide"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
