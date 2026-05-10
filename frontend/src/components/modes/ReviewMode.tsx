import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import type {
  ReviewSummary,
  Bucket,
  Pattern,
  Leak,
  RootCause,
  Session,
  SelfReport,
  DailyReport,
  SessionScore,
} from "../../types";
import { StateIcon, STATE_COLORS } from "../shared/SelfReport";

// ---------- Energy Map (SVG-based, matches onboarding chart style) ----------
// Chart constants
const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_SPAN = END_HOUR - START_HOUR; // 15
const PAD_TOP = 22; // room for labels above chart
const PAD_BOTTOM = 24; // room for x-axis labels
const BAR_GAP = 3;

function hourToFrac(h: number): number {
  return (h - START_HOUR) / HOUR_SPAN;
}

function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h % 1) * 60);
  const ampm = hh >= 12 ? "PM" : "AM";
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${display}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function fmtH24(h: number): string {
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
}

function EnergyMap({
  buckets,
  patterns,
}: {
  buckets: Bucket[];
  patterns: Pattern[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<{
    bucket: Bucket;
    x: number;
    y: number;
  } | null>(null);
  const [cfg, setCfg] = useState<{
    cutoff_hour: number;
    lunch_start: number;
    lunch_end: number;
  } | null>(null);
  const [svgW, setSvgW] = useState(600);

  // Responsive width
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSvgW(e.contentRect.width);
    });
    ro.observe(el);
    setSvgW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setCfg(c))
      .catch(() => {});
  }, []);

  const SVG_H = 200;
  const barAreaH = SVG_H - PAD_TOP - PAD_BOTTOM;

  const visible = useMemo(
    () =>
      (buckets ?? []).filter(
        (b) => (b.hour ?? 0) >= START_HOUR && (b.hour ?? 0) <= END_HOUR,
      ),
    [buckets],
  );

  const maxActivity = useMemo(
    () => Math.max(1, ...visible.map((b) => b.activity ?? 0)),
    [visible],
  );

  const barW =
    visible.length > 0 ? Math.max(2, svgW / visible.length - BAR_GAP) : 4;

  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  const lunchStart = cfg?.lunch_start ?? 12.5;
  const lunchEnd = cfg?.lunch_end ?? 13.5;
  const cutoff = cfg?.cutoff_hour ?? 16.5;

  // Regions
  const regions = useMemo(() => {
    const static_ = [
      { label: "lunch", start: lunchStart, end: lunchEnd, high: false },
      {
        label: "post-lunch dip",
        start: lunchEnd,
        end: lunchEnd + 1,
        high: false,
      },
    ];
    const dynamic: {
      label: string;
      start: number;
      end: number;
      high: boolean;
    }[] = [];
    for (const p of patterns ?? []) {
      if (p.window?.includes("\u2013")) {
        const [s, e] = p.window.split("\u2013").map((t) => {
          const parts = t.trim().split(":");
          return parts.length === 2
            ? parseInt(parts[0]) + parseInt(parts[1]) / 60
            : 0;
        });
        if (s > 0 && e > s)
          dynamic.push({
            label: p.kind,
            start: s,
            end: e,
            high: p.severity === "high",
          });
      }
    }
    return [...static_, ...dynamic];
  }, [lunchStart, lunchEnd, patterns]);

  // Hover handler
  const handleBarEnter = useCallback(
    (b: Bucket, e: React.MouseEvent<SVGRectElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setHovered({
        bucket: b,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [],
  );

  const handleBarLeave = useCallback(() => setHovered(null), []);

  // Helper to convert hour to x pixel
  const hToX = useCallback((h: number) => hourToFrac(h) * svgW, [svgW]);

  if (!buckets || buckets.length === 0) {
    return (
      <div className="em-card">
        <div className="em-svg-wrap">
          <svg ref={svgRef} width="100%" height={SVG_H} />
          <div className="em-empty-overlay">No energy data yet</div>
        </div>
      </div>
    );
  }

  return (
    <div className="em-card">
      <div className="em-svg-wrap">
        <svg
          ref={svgRef}
          width="100%"
          height={SVG_H}
          viewBox={`0 0 ${svgW} ${SVG_H}`}
          className="em-svg"
        >
          {/* Region overlays */}
          {regions.map((r, i) => {
            const rx = hToX(r.start);
            const rw = hToX(r.end) - rx;
            return (
              <g key={`r${i}`}>
                <rect
                  x={rx}
                  y={PAD_TOP}
                  width={rw}
                  height={barAreaH}
                  fill={
                    r.high ? "rgba(123,35,34,0.10)" : "rgba(123,35,34,0.04)"
                  }
                />
                <line
                  x1={rx}
                  y1={PAD_TOP}
                  x2={rx}
                  y2={PAD_TOP + barAreaH}
                  stroke="rgba(123,35,34,0.25)"
                  strokeWidth="1"
                  strokeDasharray="3 2"
                />
                <line
                  x1={rx + rw}
                  y1={PAD_TOP}
                  x2={rx + rw}
                  y2={PAD_TOP + barAreaH}
                  stroke="rgba(123,35,34,0.25)"
                  strokeWidth="1"
                  strokeDasharray="3 2"
                />
                <text
                  x={rx + 4}
                  y={PAD_TOP + 12}
                  fill="var(--color-danger-red)"
                  fontSize="9"
                  fontWeight="500"
                  opacity="0.75"
                >
                  {r.label}
                </text>
              </g>
            );
          })}

          {/* Cutoff zone fill */}
          {cutoff >= START_HOUR && cutoff <= END_HOUR && (
            <rect
              x={hToX(cutoff)}
              y={PAD_TOP}
              width={Math.max(0, svgW - hToX(cutoff))}
              height={barAreaH}
              fill="rgba(123,35,34,0.06)"
            />
          )}

          {/* Activity bars */}
          {visible.map((b, i) => {
            const activity = b.activity ?? 0;
            if (activity === 0) return null;
            const bH = (activity / maxActivity) * (barAreaH - 8);
            const bx = i * (barW + BAR_GAP) + BAR_GAP / 2;
            const by = PAD_TOP + barAreaH - bH;
            const hasError = (b.errors ?? 0) > 0;
            const isPeak = activity / maxActivity > 0.65;
            const fill = hasError
              ? "var(--color-danger-red)"
              : isPeak
                ? "var(--color-ink)"
                : "var(--color-slate)";
            return (
              <rect
                key={i}
                x={bx}
                y={by}
                width={barW}
                height={bH}
                rx={2}
                fill={fill}
                opacity={0.85}
                className="em-svg-bar"
                onMouseEnter={(e) => handleBarEnter(b, e)}
                onMouseLeave={handleBarLeave}
              />
            );
          })}

          {/* Cutoff dashed line */}
          {cutoff >= START_HOUR && cutoff <= END_HOUR && (
            <>
              <line
                x1={hToX(cutoff)}
                y1={PAD_TOP}
                x2={hToX(cutoff)}
                y2={PAD_TOP + barAreaH}
                stroke="var(--color-danger-red)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <text
                x={hToX(cutoff)}
                y={PAD_TOP - 6}
                textAnchor="middle"
                fill="var(--color-danger-red)"
                fontSize="10"
                fontWeight="600"
              >
                {formatHour(cutoff)}
              </text>
            </>
          )}

          {/* NOW line */}
          {nowH >= START_HOUR && nowH <= END_HOUR && (
            <>
              <line
                x1={hToX(nowH)}
                y1={PAD_TOP}
                x2={hToX(nowH)}
                y2={PAD_TOP + barAreaH}
                stroke="var(--color-action-blue)"
                strokeWidth="1"
              />
              <text
                x={hToX(nowH)}
                y={PAD_TOP - 6}
                textAnchor="middle"
                fill="var(--color-action-blue)"
                fontSize="9"
                fontWeight="600"
                letterSpacing="0.04em"
              >
                NOW
              </text>
            </>
          )}

          {/* X-axis labels */}
          {[7, 9, 11, 13, 15, 17, 19, 21].map((h) => (
            <text
              key={h}
              x={hToX(h)}
              y={SVG_H - 4}
              textAnchor="middle"
              fill="var(--color-overcast)"
              fontSize="10"
            >
              {h > 12 ? h - 12 : h}
              {h >= 12 ? "PM" : "AM"}
            </text>
          ))}

          {/* Baseline */}
          <line
            x1={0}
            y1={PAD_TOP + barAreaH}
            x2={svgW}
            y2={PAD_TOP + barAreaH}
            stroke="var(--color-stone)"
            strokeWidth="1"
          />
        </svg>

        {/* Hover tooltip (HTML overlay for rich styling) */}
        {hovered && (
          <div
            className="em-tooltip"
            style={{
              left: Math.min(Math.max(hovered.x, 70), svgW - 140),
              top: 28,
            }}
          >
            <div className="em-tooltip-time">
              {fmtH24(hovered.bucket.hour ?? 0)}
            </div>
            <div className="em-tooltip-row">
              <span>Activity</span>
              <b>{hovered.bucket.activity ?? 0}</b>
            </div>
            <div className="em-tooltip-row">
              <span>Saves</span>
              <b>{hovered.bucket.file_saves ?? 0}</b>
            </div>
            <div className="em-tooltip-row">
              <span>Sessions</span>
              <b>{hovered.bucket.sessions ?? 0}</b>
            </div>
            {(hovered.bucket.errors ?? 0) > 0 && (
              <div className="em-tooltip-row warn">
                <span>Errors</span>
                <b>{hovered.bucket.errors}</b>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Self-Report Chart (SVG, matches energy map style) ----------
const SR_LEVELS = [
  { level: 1, label: "fresh" },
  { level: 2, label: "focused" },
  { level: 3, label: "loaded" },
  { level: 4, label: "tired" },
  { level: 5, label: "degraded" },
];

const SR_PAD_TOP = 20;
const SR_PAD_BOTTOM = 24;
const SR_PAD_LEFT = 64; // room for y-axis labels
const SR_H = 180;

function SelfReportChart({ reports }: { reports: SelfReport[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgW, setSvgW] = useState(600);
  const [hovered, setHovered] = useState<{
    report: SelfReport;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSvgW(e.contentRect.width);
    });
    ro.observe(el);
    setSvgW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const chartW = svgW - SR_PAD_LEFT;
  const areaH = SR_H - SR_PAD_TOP - SR_PAD_BOTTOM;
  const bandH = areaH / 5;

  // Map report time to x
  const reportToX = useCallback(
    (r: SelfReport) => {
      const h = r.ts
        ? new Date(r.ts).getHours() + new Date(r.ts).getMinutes() / 60
        : (r.bucket_idx * 10) / 60;
      return SR_PAD_LEFT + hourToFrac(h) * chartW;
    },
    [chartW],
  );

  // Map level (1–5) to y center
  const levelToY = useCallback(
    (level: number) => {
      const clamped = Math.max(1, Math.min(5, level));
      return SR_PAD_TOP + (clamped - 0.5) * bandH;
    },
    [bandH],
  );

  // Sort reports by time
  const sorted = useMemo(
    () =>
      [...reports].sort(
        (a, b) => (a.ts ?? a.bucket_idx) - (b.ts ?? b.bucket_idx),
      ),
    [reports],
  );

  // Build SVG path for the connecting line
  const linePath = useMemo(() => {
    if (sorted.length < 2) return "";
    return sorted
      .map((r, i) => {
        const x = reportToX(r);
        const y = levelToY(r.level);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }, [sorted, reportToX, levelToY]);

  const handleDotEnter = useCallback(
    (r: SelfReport, e: React.MouseEvent<SVGCircleElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setHovered({
        report: r,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [],
  );

  return (
    <div className="em-card">
      <div className="em-svg-wrap">
        <svg
          ref={svgRef}
          width="100%"
          height={SR_H}
          viewBox={`0 0 ${svgW} ${SR_H}`}
          className="em-svg"
        >
          {/* Zone bands */}
          {SR_LEVELS.map((l) => {
            const y = SR_PAD_TOP + (l.level - 1) * bandH;
            const isOdd = l.level % 2 === 1;
            return (
              <g key={l.level}>
                <rect
                  x={SR_PAD_LEFT}
                  y={y}
                  width={chartW}
                  height={bandH}
                  fill={isOdd ? "rgba(0,0,0,0.02)" : "transparent"}
                />
                {/* Y-axis label */}
                <text
                  x={SR_PAD_LEFT - 10}
                  y={y + bandH / 2}
                  textAnchor="end"
                  dominantBaseline="central"
                  fill={STATE_COLORS[l.level - 1]}
                  fontSize="10"
                  fontWeight="500"
                >
                  {l.label}
                </text>
                {/* Horizontal grid line */}
                <line
                  x1={SR_PAD_LEFT}
                  y1={y}
                  x2={svgW}
                  y2={y}
                  stroke="var(--color-stone)"
                  strokeWidth="0.5"
                />
              </g>
            );
          })}
          {/* Bottom grid line */}
          <line
            x1={SR_PAD_LEFT}
            y1={SR_PAD_TOP + areaH}
            x2={svgW}
            y2={SR_PAD_TOP + areaH}
            stroke="var(--color-stone)"
            strokeWidth="1"
          />

          {/* Connecting line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--color-slate)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              opacity="0.5"
            />
          )}

          {/* Data points */}
          {sorted.map((r, i) => {
            const cx = reportToX(r);
            const cy = levelToY(r.level);
            const color = STATE_COLORS[r.level - 1] ?? STATE_COLORS[2];
            return (
              <g key={i}>
                {/* Outer glow */}
                <circle cx={cx} cy={cy} r={8} fill={color} opacity={0.12} />
                {/* Main dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill="var(--color-white)"
                  stroke={color}
                  strokeWidth={2}
                  className="em-svg-bar"
                  onMouseEnter={(e) =>
                    handleDotEnter(
                      r,
                      e as unknown as React.MouseEvent<SVGCircleElement>,
                    )
                  }
                  onMouseLeave={() => setHovered(null)}
                />
              </g>
            );
          })}

          {/* X-axis labels */}
          {[7, 9, 11, 13, 15, 17, 19, 21].map((h) => (
            <text
              key={h}
              x={SR_PAD_LEFT + hourToFrac(h) * chartW}
              y={SR_H - 4}
              textAnchor="middle"
              fill="var(--color-overcast)"
              fontSize="10"
            >
              {h > 12 ? h - 12 : h}
              {h >= 12 ? "PM" : "AM"}
            </text>
          ))}
        </svg>

        {/* Tooltip */}
        {hovered && (
          <div
            className="em-tooltip"
            style={{
              left: Math.min(Math.max(hovered.x, 70), svgW - 140),
              top: Math.max(8, hovered.y - 70),
            }}
          >
            <div className="em-tooltip-time">
              {hovered.report.ts
                ? new Date(hovered.report.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </div>
            <div className="em-tooltip-row">
              <span>State</span>
              <b
                style={{
                  color: STATE_COLORS[hovered.report.level - 1],
                  textTransform: "capitalize",
                }}
              >
                {hovered.report.label}
              </b>
            </div>
            {hovered.report.note && (
              <div className="em-tooltip-row">
                <span>Note</span>
                <b>{hovered.report.note}</b>
              </div>
            )}
          </div>
        )}
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
  "perf-degradation": "⚡",
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [scores, setScores] = useState<SessionScore[]>([]);

  useEffect(() => {
    const n = new Date();
    const day = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    api
      .getReview(day)
      .then((data) => {
        if (data) {
          setReview(data);
          setSessions(data.sessions ?? []);
        }
      })
      .catch((err) => setError(err?.message ?? "Failed to load review"))
      .finally(() => setLoading(false));
    api
      .getReport(day)
      .then(setReport)
      .catch(() => {});
    api
      .getSessionScores(day)
      .then(setScores)
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="review">
        <div className="review-inner">
          <h1 className="review-h">Today's review</h1>
          <div className="review-sub">Loading...</div>

          {/* Summary stat skeletons */}
          <div className="review-skeleton">
            <div className="review-summary">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rs-cell">
                  <div
                    className="skeleton-block"
                    style={{ width: 48, height: 28, marginBottom: 8 }}
                  />
                  <div
                    className="skeleton-block"
                    style={{ width: 72, height: 12 }}
                  />
                </div>
              ))}
            </div>

            {/* Energy map skeleton */}
            <div
              className="skeleton-block"
              style={{
                width: "100%",
                height: 180,
                borderRadius: "var(--radius-cards)",
                marginTop: 32,
              }}
            />

            {/* Pattern card skeletons */}
            <div style={{ marginTop: 32 }}>
              <div
                className="skeleton-block"
                style={{ width: 120, height: 14, marginBottom: 16 }}
              />
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="skeleton-row"
                  style={{ marginBottom: 12 }}
                >
                  <div className="skeleton-circle" />
                  <div style={{ flex: 1 }}>
                    <div
                      className="skeleton-block"
                      style={{ width: "60%", height: 14, marginBottom: 8 }}
                    />
                    <div
                      className="skeleton-block"
                      style={{ width: "90%", height: 12 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
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

        {/* Daily Intelligence Report */}
        <div className="section">
          <h2 className="section-h">Daily intelligence</h2>
          {!report ? (
            <div className="review-report-empty">Generating report…</div>
          ) : report.sections.length === 0 ? (
            <div className="review-report-empty">
              Not enough data yet. Keep working and the report will populate as
              activity is recorded.
            </div>
          ) : (
            <div className="review-report">
              {report.sections.map((s, i) => (
                <div key={i} className="review-report-section">
                  <div className="review-report-title">{s.title}</div>
                  <div className="review-report-content">{s.content}</div>
                </div>
              ))}
              {report.suggestions.length > 0 && (
                <div className="review-report-suggestions">
                  <div className="review-report-title">
                    What to change tomorrow
                  </div>
                  {report.suggestions.map((s, i) => (
                    <div key={i} className="review-suggestion">
                      <span className="review-suggestion-num">{i + 1}</span>
                      <div className="review-suggestion-body">
                        <div className="review-suggestion-title">{s.title}</div>
                        <div className="review-suggestion-detail">
                          {s.detail}
                        </div>
                        <div className="review-suggestion-metric">
                          📏 {s.metric}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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

        {/* Self-Report Chart */}
        {review.self_reports && review.self_reports.length > 0 && (
          <div className="section">
            <h2 className="section-h">Self-reported state</h2>
            <SelfReportChart reports={review.self_reports} />
          </div>
        )}

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
            {scores.length > 0 &&
              (() => {
                const high = scores.filter((s) => s.output_score >= 60).length;
                const low = scores.filter((s) => s.output_score < 30).length;
                return high > 0 || low > 0 ? (
                  <div className="review-score-summary">
                    {high > 0 && (
                      <span className="review-score-high">
                        {high} high-leverage
                      </span>
                    )}
                    {low > 0 && (
                      <span className="review-score-low">{low} low-output</span>
                    )}
                  </div>
                ) : null;
              })()}
            <div className="review-sessions">
              <div className="review-sess-head">
                <span>Thread</span>
                <span>Started</span>
                <span>Msgs</span>
                <span>Score</span>
                <span>Status</span>
                <span></span>
              </div>
              {sessions.map((s, i) => {
                const sessionScore = scores.find(
                  (sc) => sc.session_id === s.id,
                );
                const score = sessionScore?.output_score ?? -1;
                return (
                  <div
                    key={s.id ?? i}
                    className={`review-sess-row ${s.status}`}
                  >
                    <span className="review-sess-label">{s.label}</span>
                    <span className="review-sess-time">
                      {s.started_at
                        ? new Date(s.started_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                    <span className="review-sess-msgs">{s.message_count}</span>
                    <span
                      className={`review-sess-score ${
                        score >= 60 ? "high" : score < 30 ? "low" : "mid"
                      }`}
                    >
                      {score >= 0 ? score : "—"}
                    </span>
                    <span className={`review-sess-status ${s.status}`}>
                      {s.status}
                    </span>
                    <span className="review-sess-action">
                      {(s.status === "open" || s.status === "stalled") && (
                        <button onClick={() => closeSession(s.id)}>
                          close
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
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
