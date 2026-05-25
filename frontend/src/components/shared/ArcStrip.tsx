import { useRef, useState, useEffect } from "react";
import type { Bucket, SelfReport } from "../../types";

interface ArcStripProps {
  buckets: Bucket[];
  selfReports: SelfReport[];
  wallTime?: string;
}

const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_SPAN = END_HOUR - START_HOUR; // 15 hours

// Each bucket is 10 minutes = 1/6 of an hour
const BUCKET_DURATION_H = 10 / 60;

function hourToX(h: number, w: number): number {
  return ((h - START_HOUR) / HOUR_SPAN) * w;
}

function bucketBarWidth(w: number): number {
  // Width of one 10-min bucket in pixels, minus 1px gap
  return Math.max(2, (BUCKET_DURATION_H / HOUR_SPAN) * w - 1);
}

function wallTimeToHour(wt: string): number | null {
  const parts = wt.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h + m / 60;
}

function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h % 1) * 60);
  const ampm = hh >= 12 ? "PM" : "AM";
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return mm > 0
    ? `${display}:${String(mm).padStart(2, "0")} ${ampm}`
    : `${display} ${ampm}`;
}

function generateArcSentence(buckets: Bucket[], wallTime?: string): string {
  if (buckets.length === 0) return "No activity data yet for today.";

  const visible = buckets.filter(
    (b) => b.hour >= START_HOUR && b.hour <= END_HOUR,
  );
  if (visible.length === 0) return "No activity in the tracked window.";

  const maxActivity = Math.max(...visible.map((b) => b.activity));
  if (maxActivity === 0) return "No activity recorded today.";

  const threshold = maxActivity * 0.6;
  const peakBuckets = visible.filter((b) => b.activity >= threshold);

  let sentence = "";
  if (peakBuckets.length > 0) {
    const peakStart = peakBuckets[0].hour;
    const peakEnd =
      peakBuckets[peakBuckets.length - 1].hour + BUCKET_DURATION_H;
    sentence = `Peak window: ${formatHour(peakStart)}–${formatHour(peakEnd)}.`;
  }

  const morning = visible.filter((b) => b.hour >= 9 && b.hour < 12);
  const afternoon = visible.filter((b) => b.hour >= 13 && b.hour < 15);
  if (morning.length > 0 && afternoon.length > 0) {
    const mAvg = morning.reduce((s, b) => s + b.activity, 0) / morning.length;
    const aAvg =
      afternoon.reduce((s, b) => s + b.activity, 0) / afternoon.length;
    if (mAvg > 0 && (mAvg - aAvg) / mAvg > 0.4) {
      sentence += ` Activity dropped ${Math.round(((mAvg - aAvg) / mAvg) * 100)}% after lunch.`;
    }
  }

  if (wallTime) {
    sentence += ` The e-bike wall arrived at ${wallTime}.`;
  }

  return sentence || "Activity tracked throughout the day.";
}

const SR_COLORS: Record<number, string> = {
  1: "var(--color-success-green)",
  2: "var(--color-action-blue)",
  3: "var(--color-warning-yellow)",
  4: "var(--color-danger-red)",
  5: "var(--color-danger-red)",
};

export default function ArcStrip({
  buckets,
  selfReports,
  wallTime,
}: ArcStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [tooltip, setTooltip] = useState<{
    x: number;
    bucket: Bucket;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const CHART_H = 80;
  const LABEL_H = 20;
  const BASELINE_Y = CHART_H; // bars grow upward from here
  const TOTAL_H = CHART_H + LABEL_H;

  const visible = buckets.filter(
    (b) => b.hour >= START_HOUR && b.hour <= END_HOUR,
  );
  const maxActivity = Math.max(...visible.map((b) => b.activity), 1);
  const barW = bucketBarWidth(width);

  const wallHour = wallTime ? wallTimeToHour(wallTime) : null;
  const wallX = wallHour !== null ? hourToX(wallHour, width) : null;

  const sentence = generateArcSentence(buckets, wallTime);

  // Tick marks for hour labels
  const labelHours = [7, 9, 12, 15, 18, 21];

  return (
    <div className="arc-strip" ref={containerRef}>
      <svg
        width={width}
        height={TOTAL_H}
        viewBox={`0 0 ${width} ${TOTAL_H}`}
        style={{ display: "block" }}
      >
        {/* Full-day background track */}
        <rect
          x={0}
          y={BASELINE_Y - 2}
          width={width}
          height={2}
          fill="var(--color-stone)"
          rx={1}
        />

        {/* Activity bars — each positioned by its actual hour */}
        {visible.map((b, i) => {
          if (b.activity === 0) return null;
          const x = hourToX(b.hour, width);
          const barH = Math.max(2, (b.activity / maxActivity) * (CHART_H - 4));
          const y = BASELINE_Y - barH;
          const hasError = b.errors > 0;
          const isPeak = b.activity / maxActivity > 0.75;
          const fill = hasError
            ? "var(--color-danger-red)"
            : isPeak
              ? "var(--color-ink)"
              : "var(--color-slate)";
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill={fill}
              rx={1}
              onMouseEnter={() => setTooltip({ x, bucket: b })}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}

        {/* Wall time marker */}
        {wallX !== null && (
          <>
            <line
              x1={wallX}
              y1={4}
              x2={wallX}
              y2={BASELINE_Y}
              stroke="var(--color-danger-red)"
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
            <text
              x={wallX + 3}
              y={14}
              fontSize={9}
              fill="var(--color-danger-red)"
              fontWeight={600}
            >
              wall
            </text>
          </>
        )}

        {/* Self-report dots — pinned to baseline */}
        {selfReports.map((sr, i) => {
          const h =
            new Date(sr.ts).getHours() + new Date(sr.ts).getMinutes() / 60;
          if (h < START_HOUR || h > END_HOUR) return null;
          const x = hourToX(h, width);
          const color = SR_COLORS[sr.level] ?? "var(--color-overcast)";
          return (
            <circle
              key={i}
              cx={x}
              cy={BASELINE_Y - 6}
              r={4}
              fill={color}
              stroke="var(--color-white)"
              strokeWidth={1.5}
            />
          );
        })}

        {/* X-axis hour labels */}
        {labelHours.map((hr) => {
          const x = hourToX(hr, width);
          const ampm = hr >= 12 ? "PM" : "AM";
          const display = hr > 12 ? hr - 12 : hr;
          return (
            <text
              key={hr}
              x={x}
              y={TOTAL_H - 3}
              fontSize={10}
              fill="var(--color-lead)"
              textAnchor="middle"
            >
              {display}
              {ampm}
            </text>
          );
        })}

        {/* Tooltip */}
        {tooltip &&
          (() => {
            const tx = Math.min(Math.max(tooltip.x, 55), width - 55);
            return (
              <g>
                <rect
                  x={tx - 54}
                  y={4}
                  width={108}
                  height={36}
                  rx={4}
                  fill="var(--color-ink)"
                  opacity={0.92}
                />
                <text
                  x={tx}
                  y={18}
                  fontSize={10}
                  fill="var(--color-white)"
                  textAnchor="middle"
                >
                  {formatHour(tooltip.bucket.hour)} · {tooltip.bucket.activity}{" "}
                  act
                </text>
                <text
                  x={tx}
                  y={32}
                  fontSize={10}
                  fill="rgba(255,255,255,0.55)"
                  textAnchor="middle"
                >
                  {tooltip.bucket.errors > 0
                    ? `${tooltip.bucket.errors} errors · `
                    : ""}
                  {tooltip.bucket.file_saves} saves
                </text>
              </g>
            );
          })()}
      </svg>

      <p className="arc-sentence">{sentence}</p>
    </div>
  );
}
