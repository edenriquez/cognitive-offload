import { useRef, useState, useMemo } from "react";
import type { DailySummaryRecord } from "../../types";

interface ContributionCalendarProps {
  data: DailySummaryRecord[];
  onDayClick: (day: string) => void;
}

const CELL = 12;
const GAP = 2;
const STEP = CELL + GAP;
const ROWS = 7;
const COLS = 52;
const LABEL_W = 28;
const TOP_PAD = 18;

function color(minutes: number): string {
  if (minutes <= 0) return "var(--color-ash)";
  if (minutes < 30) return "#9be9a8";
  if (minutes < 90) return "#40c463";
  if (minutes < 180) return "#30a14e";
  return "#216e39";
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_LABELS: [number, string][] = [
  [1, "Mon"],
  [3, "Wed"],
  [5, "Fri"],
];

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export default function ContributionCalendar({
  data,
  onDayClick,
}: ContributionCalendarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    day: string;
    minutes: number;
    x: number;
    y: number;
  } | null>(null);

  // Build lookup map: day string → deep_work_min
  const lookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const rec of data) {
      m.set(rec.day, rec.deep_work_min);
    }
    return m;
  }, [data]);

  // Build grid from Jan 1 of current year to today
  const { cells, monthLabels, todayStr, totalCols } = useMemo(() => {
    const today = new Date();
    const todayStr = formatDate(today);

    const cells: {
      day: string;
      col: number;
      row: number;
      minutes: number;
      isToday: boolean;
    }[] = [];

    // Start from Jan 1 of current year
    const startDate = new Date(today.getFullYear(), 0, 1);

    // Adjust startDate backwards to the nearest Monday
    const startDow = startDate.getDay();
    const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
    startDate.setDate(startDate.getDate() + mondayOffset);

    const monthLabels: { col: number; label: string }[] = [];
    let lastMonth = -1;

    const cursor = new Date(startDate);
    let col = 0;

    // Iterate until we pass today (not fixed 52 cols)
    while (cursor <= today || cursor.getDay() !== 1) {
      for (let row = 0; row < ROWS; row++) {
        const dayStr = formatDate(cursor);
        const isFuture = cursor > today;

        cells.push({
          day: dayStr,
          col,
          row,
          minutes: isFuture ? -1 : (lookup.get(dayStr) ?? 0),
          isToday: dayStr === todayStr,
        });

        // Track month labels on the first row
        if (row === 0) {
          const m = cursor.getMonth();
          if (m !== lastMonth) {
            monthLabels.push({ col, label: MONTH_NAMES[m] });
            lastMonth = m;
          }
        }

        cursor.setDate(cursor.getDate() + 1);
        if (isFuture && row === ROWS - 1) break;
      }
      col++;
      if (cursor > today && cursor.getDay() === 1) break;
    }

    return { cells, monthLabels, todayStr, totalCols: col };
  }, [lookup]);

  const svgW = LABEL_W + totalCols * STEP;
  const svgH = TOP_PAD + ROWS * STEP;

  const handleMouseEnter = (
    e: React.MouseEvent<SVGRectElement>,
    day: string,
    minutes: number,
  ) => {
    const svg = wrapRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const er = (e.target as SVGRectElement).getBoundingClientRect();
    setTooltip({
      day,
      minutes,
      x: er.left - rect.left + CELL / 2,
      y: er.top - rect.top - 8,
    });
  };

  return (
    <div
      className="contrib-calendar"
      ref={wrapRef}
      style={{ position: "relative", margin: "40px 0" }}
    >
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: "block" }}
      >
        {/* Month labels */}
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={LABEL_W + m.col * STEP}
            y={12}
            fontSize={10}
            fill="var(--color-overcast)"
            fontFamily="var(--font-inter), system-ui, sans-serif"
          >
            {m.label}
          </text>
        ))}

        {/* Day-of-week labels */}
        {DAY_LABELS.map(([row, label]) => (
          <text
            key={row}
            x={0}
            y={TOP_PAD + row * STEP + CELL - 2}
            fontSize={10}
            fill="var(--color-overcast)"
            fontFamily="var(--font-inter), system-ui, sans-serif"
          >
            {label}
          </text>
        ))}

        {/* Day cells */}
        {cells.map((c) =>
          c.minutes < 0 ? null : (
            <rect
              key={c.day}
              className={`contrib-cell${c.isToday ? " contrib-today" : ""}`}
              x={LABEL_W + c.col * STEP}
              y={TOP_PAD + c.row * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              fill={color(c.minutes)}
              onClick={() => onDayClick(c.day)}
              onMouseEnter={(e) => handleMouseEnter(e, c.day, c.minutes)}
              onMouseLeave={() => setTooltip(null)}
            />
          ),
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="em-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
            pointerEvents: "none",
          }}
        >
          <div className="em-tooltip-time">{tooltip.day}</div>
          <div className="em-tooltip-row">
            <b>{tooltip.minutes}m</b> deep work
          </div>
        </div>
      )}
    </div>
  );
}
