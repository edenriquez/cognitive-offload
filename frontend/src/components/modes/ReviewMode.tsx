import { useState, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import type {
  ReviewSummary,
  Bucket,
  Pattern,
  Leak,
  RootCause,
  Session,
} from "../../types";

// ---------- Energy Map (matches v8 design) ----------
function EnergyMap({
  buckets,
  patterns,
}: {
  buckets: Bucket[];
  patterns: Pattern[];
}) {
  const [hovered, setHovered] = useState<Bucket | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [activeRegion, setActiveRegion] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [cfg, setCfg] = useState<{
    cutoff_hour: number;
    lunch_start: number;
    lunch_end: number;
  } | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setCfg(c))
      .catch(() => {});
  }, []);

  if (!buckets || buckets.length === 0) {
    return (
      <div className="em">
        <div className="em-area em-empty">No energy data yet</div>
        <div className="em-x"></div>
      </div>
    );
  }

  const visible = buckets.filter(
    (b) => (b.hour ?? 0) >= 7 && (b.hour ?? 0) <= 22,
  );
  const w = 100 / visible.length;
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;

  // Static regions from config (adjustable)
  const lunchStart = cfg?.lunch_start ?? 12.5;
  const lunchEnd = cfg?.lunch_end ?? 13.5;
  const cutoff = cfg?.cutoff_hour ?? 16.5;
  const staticRegions = [
    { label: "lunch", start: lunchStart, end: lunchEnd },
    { label: "post-lunch dip", start: lunchEnd, end: lunchEnd + 1 },
    { label: "past cutoff", start: cutoff, end: cutoff + 1.5 },
  ];

  // Dynamic regions from detected patterns
  const patternRegions: {
    label: string;
    start: number;
    end: number;
    high: boolean;
  }[] = [];
  for (const p of patterns ?? []) {
    if (p.window?.includes("–")) {
      const [s, e] = p.window.split("–").map((t) => {
        const parts = t.trim().split(":");
        return parts.length === 2
          ? parseInt(parts[0]) + parseInt(parts[1]) / 60
          : 0;
      });
      if (s > 0 && e > s)
        patternRegions.push({
          label: p.kind,
          start: s,
          end: e,
          high: p.severity === "high",
        });
    }
  }

  const fmtH = (h: number) =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className="em">
      <div className="em-area">
        {/* Static annotation regions */}
        {staticRegions.map((r, i) => (
          <div
            key={`s${i}`}
            className={`em-region ${activeRegion?.start === r.start ? "em-region-active" : ""}`}
            style={{
              left: `${((r.start - 7) / 15) * 100}%`,
              width: `${((r.end - r.start) / 15) * 100}%`,
            }}
            onMouseEnter={() => setActiveRegion({ start: r.start, end: r.end })}
            onMouseLeave={() => setActiveRegion(null)}
          >
            <span className="em-region-label">{r.label}</span>
          </div>
        ))}

        {/* Dynamic pattern regions */}
        {patternRegions.map((r, i) => (
          <div
            key={`p${i}`}
            className={`em-region ${r.high ? "em-region-high" : ""} ${activeRegion?.start === r.start ? "em-region-active" : ""}`}
            style={{
              left: `${((r.start - 7) / 15) * 100}%`,
              width: `${((r.end - r.start) / 15) * 100}%`,
            }}
            onMouseEnter={() => setActiveRegion({ start: r.start, end: r.end })}
            onMouseLeave={() => setActiveRegion(null)}
          >
            <span
              className={`em-region-label ${r.high ? "em-region-label-high" : ""}`}
            >
              {r.label}
            </span>
          </div>
        ))}

        {/* Dim overlay when region is hovered */}
        {activeRegion && (
          <>
            <div
              className="em-dim"
              style={{
                left: 0,
                width: `${((activeRegion.start - 7) / 15) * 100}%`,
              }}
            />
            <div
              className="em-dim"
              style={{
                left: `${((activeRegion.end - 7) / 15) * 100}%`,
                right: 0,
              }}
            />
          </>
        )}

        {/* Bars */}
        {visible.map((b, i) => {
          const activity = b.activity ?? 0;
          if (activity === 0) return null;
          const cls =
            (b.errors ?? 0) > 0 ? "warn" : activity > 65 ? "peak" : "";
          return (
            <span
              key={i}
              className={`em-bar ${cls}`}
              style={{
                left: `${i * w + w / 2}%`,
                height: `${activity}%`,
                opacity: activeRegion
                  ? (b.hour ?? 0) >= activeRegion.start &&
                    (b.hour ?? 0) < activeRegion.end
                    ? 1
                    : 0.15
                  : undefined,
              }}
              onMouseEnter={(e) => {
                setHovered(b);
                const rect =
                  e.currentTarget.parentElement?.getBoundingClientRect();
                if (rect) setHoverX(e.clientX - rect.left);
              }}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}

        {/* NOW line */}
        {nowH >= 7 && nowH <= 22 && (
          <span
            className="em-now"
            style={{ left: `${((nowH - 7) / 15) * 100}%` }}
          />
        )}

        {/* Tooltip */}
        {hovered && (
          <div
            className="em-tooltip"
            style={{ left: Math.min(Math.max(hoverX, 60), 300) }}
          >
            <div className="em-tooltip-time">{fmtH(hovered.hour ?? 0)}</div>
            <div className="em-tooltip-row">
              <span>Activity</span>
              <b>{hovered.activity ?? 0}</b>
            </div>
            <div className="em-tooltip-row">
              <span>Saves</span>
              <b>{hovered.file_saves ?? 0}</b>
            </div>
            <div className="em-tooltip-row">
              <span>Sessions</span>
              <b>{hovered.sessions ?? 0}</b>
            </div>
            {(hovered.errors ?? 0) > 0 && (
              <div className="em-tooltip-row warn">
                <span>Errors</span>
                <b>{hovered.errors}</b>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="em-x">
        {[7, 9, 11, 13, 15, 17, 19, 21].map((h) => (
          <span key={h} style={{ left: `${((h - 7) / 15) * 100}%` }}>
            {h.toString().padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Helpers ----------
function fmtMin(mins: unknown): string {
  const n = typeof mins === "number" && !isNaN(mins) ? mins : 0;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const KIND_ICONS: Record<string, string> = {
  thrashing: "⚡",
  crash: "📉",
  fatigue: "🔥",
  stuck: "🔄",
  "open-loops": "🔓",
  "cold-start": "❄️",
  overwork: "⏰",
};

const SEVERITY_CLASS: Record<string, string> = {
  high: "high",
  medium: "",
  low: "",
};

// ---------- Main Component ----------
export default function ReviewMode() {
  const setMode = useAppStore((s) => s.setMode);
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const n = new Date();
    const day = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    api
      .getReview(day)
      .then((data) => {
        if (data) setReview(data);
      })
      .catch((err) => setError(err?.message ?? "Failed to load review"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="review">
        <div className="review-inner">
          <h1 className="review-h">Today's review</h1>
          <div className="review-sub">Loading...</div>
        </div>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="review">
        <div className="review-inner">
          <h1 className="review-h">Today's review</h1>
          <div className="review-sub">
            {error ?? "No data yet. Work for a while and come back."}
          </div>
        </div>
      </div>
    );
  }

  const summary = review.summary ?? {
    deep_work_min: 0,
    leaked_min: 0,
    open_loops: 0,
    sessions_count: 0,
  };
  const energy_map = review.energy_map ?? [];
  const patterns = review.patterns ?? [];
  const leaks = review.leaks ?? [];
  const rootCauses = review.root_causes ?? [];
  const [sessions, setSessions] = useState(review.sessions ?? []);

  const closeSession = async (id: string) => {
    try {
      await api.closeSession(id);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: "closed" as const } : s,
        ),
      );
    } catch {}
  };

  const closeAllOpen = async () => {
    const open = sessions.filter(
      (s) => s.status === "open" || s.status === "stalled",
    );
    for (const s of open) {
      try {
        await api.closeSession(s.id);
      } catch {}
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.status === "open" || s.status === "stalled"
          ? { ...s, status: "closed" as const }
          : s,
      ),
    );
  };

  const hasMeaningfulData =
    summary.deep_work_min > 0 ||
    summary.sessions_count > 0 ||
    energy_map.length > 0;

  return (
    <div className="review">
      <div className="review-inner">
        <h1 className="review-h">Today's review</h1>
        <div className="review-sub">
          Auto-generated from logs · not self-report
        </div>

        {/* Summary stats */}
        <div className="review-summary">
          <div className="rs-cell">
            <div className="rs-v">{fmtMin(summary.deep_work_min)}</div>
            <div className="rs-l">Deep work</div>
          </div>
          <div className="rs-cell">
            <div className={`rs-v ${summary.leaked_min > 30 ? "danger" : ""}`}>
              {fmtMin(summary.leaked_min)}
            </div>
            <div className="rs-l">Leaked time</div>
          </div>
          <div className="rs-cell">
            <div
              className={`rs-v ${(summary.open_loops ?? 0) >= 3 ? "danger" : ""}`}
            >
              {summary.open_loops ?? 0}
            </div>
            <div className="rs-l">Open loops</div>
          </div>
          <div className="rs-cell">
            <div className="rs-v">{summary.sessions_count ?? 0}</div>
            <div className="rs-l">Sessions</div>
          </div>
        </div>

        {/* Energy map */}
        <div className="section">
          <h2 className="section-h">Energy map</h2>
          <div className="em-card">
            <EnergyMap buckets={energy_map} patterns={patterns} />
            {energy_map.length > 0 && (
              <div className="em-legend">
                <span>
                  <i className="em-legend-bar peak"></i> peak activity
                </span>
                <span>
                  <i className="em-legend-bar"></i> normal
                </span>
                <span>
                  <i className="em-legend-bar warn"></i> errors
                </span>
                <span>
                  <i className="em-legend-now"></i> now
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Patterns */}
        {patterns.length > 0 && (
          <div className="section">
            <h2 className="section-h">Detected patterns</h2>
            <div className="review-patterns">
              {patterns.map((p, i) => (
                <div
                  key={p.id ?? i}
                  className={`review-pat ${SEVERITY_CLASS[p.severity] ?? ""}`}
                >
                  <div className="review-pat-icon">
                    {KIND_ICONS[p.kind] ?? "⚠️"}
                  </div>
                  <div className="review-pat-body">
                    <div className="review-pat-head">
                      <span
                        className={`review-pat-kind ${p.severity === "high" ? "high" : ""}`}
                      >
                        {p.kind}
                      </span>
                      <span className="review-pat-window">
                        {p.window ?? ""}
                      </span>
                    </div>
                    <div className="review-pat-title">{p.title ?? ""}</div>
                    <div className="review-pat-detail">{p.detail ?? ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Energy leaks */}
        {leaks.length > 0 && (
          <div className="section">
            <h2 className="section-h">Where time leaked</h2>
            <div className="review-leaks">
              {leaks.map((l, i) => (
                <div key={i} className="review-leak">
                  <span className="review-leak-time">{l.time ?? ""}</span>
                  <span className="review-leak-cost">{l.cost ?? ""}</span>
                  <div className="review-leak-body">
                    <span className="review-leak-cause">{l.cause ?? ""}</span>
                    <span className="review-leak-fix">{l.fix ?? ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Root causes */}
        {rootCauses.length > 0 && (
          <div className="section">
            <h2 className="section-h">Root causes</h2>
            <div className="review-roots">
              {rootCauses.map((r, i) => (
                <div key={i} className="review-root">
                  <div className="review-root-signal">{r.signal}</div>
                  <div className="review-root-cause">{r.cause}</div>
                  <div className="review-root-conf">
                    <div className="review-root-bar">
                      <span style={{ width: `${r.confidence}%` }}></span>
                    </div>
                    <span>{r.confidence}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sessions */}
        {sessions.length > 0 && (
          <div className="section">
            <div className="review-sess-header">
              <h2 className="section-h">Sessions</h2>
              {sessions.some(
                (s) => s.status === "open" || s.status === "stalled",
              ) && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={closeAllOpen}
                >
                  Close all open
                </button>
              )}
            </div>
            <div className="review-sessions">
              <div className="review-sess-head">
                <span>Thread</span>
                <span>Started</span>
                <span>Msgs</span>
                <span>Status</span>
                <span></span>
              </div>
              {sessions.map((s, i) => (
                <div key={s.id ?? i} className={`review-sess-row ${s.status}`}>
                  <span className="review-sess-label">{s.label}</span>
                  <span className="review-sess-time">
                    {new Date(s.started_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="review-sess-msgs">{s.message_count}</span>
                  <span className={`review-sess-status ${s.status}`}>
                    {s.status}
                  </span>
                  <span className="review-sess-action">
                    {(s.status === "open" || s.status === "stalled") && (
                      <button onClick={() => closeSession(s.id)}>close</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No data prompt */}
        {!hasMeaningfulData && (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-overcast)",
              padding: "32px 0",
              fontSize: 13,
            }}
          >
            Not enough data for a full review. Keep working and check back
            later.
          </div>
        )}

        {/* Tomorrow CTA */}
        <div className="tom-card">
          <div>
            <div className="tom-eye">Tomorrow's plan</div>
            <div className="tom-line">
              Review complete. <b>Open the plan</b> to see auto-generated
              constraints and tasks.
            </div>
          </div>
          <button className="btn-primary" onClick={() => setMode("tomorrow")}>
            Open plan
          </button>
        </div>
      </div>
    </div>
  );
}
