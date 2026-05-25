interface InsightStatProps {
  value: string;       // formatted display value e.g. "2h 40m"
  label: string;       // e.g. "Deep work"
  trend: number[];     // 7 values, oldest first
  higherIsBetter: boolean;
  danger?: boolean;    // show value in red
}

function Sparkline({ values }: { values: number[]; higherIsBetter: boolean }) {
  if (values.length === 0) return null;
  const W = 56;
  const H = 20;
  const max = Math.max(...values, 1);
  const barW = W / values.length - 1;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * H);
        const x = i * (barW + 1);
        const y = H - h;
        const isLast = i === values.length - 1;
        const fill = isLast
          ? "var(--color-ink)"
          : "var(--color-stone)";
        return <rect key={i} x={x} y={y} width={barW} height={h} rx={1} fill={fill} />;
      })}
    </svg>
  );
}

export default function InsightStat({ value, label, trend, higherIsBetter, danger }: InsightStatProps) {
  const prev = trend.length >= 2 ? trend[trend.length - 2] : null;
  const curr = trend.length >= 1 ? trend[trend.length - 1] : null;

  let direction: "up" | "down" | "flat" = "flat";
  if (prev !== null && curr !== null && prev !== 0) {
    const delta = (curr - prev) / prev;
    if (delta > 0.05) direction = "up";
    else if (delta < -0.05) direction = "down";
  }

  const isGood = (direction === "up" && higherIsBetter) || (direction === "down" && !higherIsBetter);
  const isBad = (direction === "down" && higherIsBetter) || (direction === "up" && !higherIsBetter);

  return (
    <div className="insight-stat">
      <div className={`insight-stat-value${danger ? " insight-stat-value--danger" : ""}`}>
        {value}
      </div>
      <div className="insight-stat-label">{label}</div>
      <div className="insight-stat-footer">
        <Sparkline values={trend} higherIsBetter={higherIsBetter} />
        {direction !== "flat" && (
          <span className={`insight-stat-dir${isGood ? " good" : isBad ? " bad" : ""}`}>
            {direction === "up" ? (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M3 8l5-5 5 5" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v10M3 8l5 5 5-5" />
              </svg>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
