import { useRef, useState, useCallback, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";

/* ── Stacked-chevron icons ──────────────────────────────────
   1 fresh     ∧∧∧  3 chevrons up     muted blue
   2 focused   ∧∧   2 chevrons up     blue-gray
   3 loaded    ──   flat line          neutral
   4 tired     ∨∨   2 chevrons down   muted amber
   5 degraded  ∨∨∨  3 chevrons down   muted red
   ────────────────────────────────────────────────────────── */

export const STATE_COLORS = [
  "#4a7c9b",
  "#5e8a96",
  "#8f99a8",
  "#a08858",
  "#9b4a4a",
];

export function StateIcon({
  level,
  size = 14,
}: {
  level: number;
  size?: number;
}) {
  const color = STATE_COLORS[level - 1] ?? STATE_COLORS[2];
  const sw = 1.5;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 12 14",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
  };
  const pathProps = {
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (level) {
    case 1:
      return (
        <svg {...common}>
          <path d="M2.5 10.5 L6 7.5 L9.5 10.5" {...pathProps} />
          <path d="M2.5 7.5 L6 4.5 L9.5 7.5" {...pathProps} />
          <path d="M2.5 4.5 L6 1.5 L9.5 4.5" {...pathProps} />
        </svg>
      );
    case 2:
      return (
        <svg {...common}>
          <path d="M2.5 9 L6 6 L9.5 9" {...pathProps} />
          <path d="M2.5 6 L6 3 L9.5 6" {...pathProps} />
        </svg>
      );
    case 3:
      return (
        <svg {...common}>
          <path d="M2 7 L10 7" {...pathProps} />
        </svg>
      );
    case 4:
      return (
        <svg {...common}>
          <path d="M2.5 5 L6 8 L9.5 5" {...pathProps} />
          <path d="M2.5 8 L6 11 L9.5 8" {...pathProps} />
        </svg>
      );
    case 5:
      return (
        <svg {...common}>
          <path d="M2.5 3.5 L6 6.5 L9.5 3.5" {...pathProps} />
          <path d="M2.5 6.5 L6 9.5 L9.5 6.5" {...pathProps} />
          <path d="M2.5 9.5 L6 12.5 L9.5 9.5" {...pathProps} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M2 7 L10 7" {...pathProps} />
        </svg>
      );
  }
}

const LEVELS = [
  { level: 1, label: "fresh", desc: "Sharp & clear" },
  { level: 2, label: "focused", desc: "Good flow" },
  { level: 3, label: "loaded", desc: "Handling it" },
  { level: 4, label: "tired", desc: "Feeling it" },
  { level: 5, label: "degraded", desc: "Running on fumes" },
];

export default function SelfReport() {
  const {
    selfReportOpen,
    setSelfReportOpen,
    lastSelfReport,
    setLastSelfReport,
  } = useAppStore();

  const startX = useRef(0);
  const currentX = useRef(0);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [confirming, setConfirming] = useState<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    hasDragged.current = false;
    startX.current = e.clientX;
    currentX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      currentX.current = e.clientX;
      const dx = currentX.current - startX.current;
      if (Math.abs(dx) > 4) hasDragged.current = true;
      if (selfReportOpen) {
        setDragOffset(Math.max(0, dx));
      } else {
        setDragOffset(Math.min(0, dx));
      }
    },
    [selfReportOpen],
  );

  const onPointerUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dx = currentX.current - startX.current;
    if (selfReportOpen && dx > 60) setSelfReportOpen(false);
    else if (!selfReportOpen && dx < -60) setSelfReportOpen(true);
    setDragOffset(0);
  }, [selfReportOpen, setSelfReportOpen]);

  const onHandleClick = useCallback(() => {
    if (hasDragged.current) return;
    setSelfReportOpen(!selfReportOpen);
  }, [selfReportOpen, setSelfReportOpen]);

  const onOverlayClick = useCallback(() => {
    setSelfReportOpen(false);
  }, [setSelfReportOpen]);

  const reportLevel = useCallback(
    (level: number, label: string) => {
      if (confirming !== null) return;
      setConfirming(level);
      setLastSelfReport({ level, label, ts: Date.now() });

      // Fire API in background — animation doesn't wait
      api.createSelfReport(level, label).catch(() => {});

      // Collapse after confirming animation plays
      setTimeout(() => setSelfReportOpen(false), 500);
      setTimeout(() => setConfirming(null), 850);
    },
    [confirming, setLastSelfReport, setSelfReportOpen],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selfReportOpen) setSelfReportOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selfReportOpen, setSelfReportOpen]);

  const timeSince = lastSelfReport
    ? Math.round((Date.now() - lastSelfReport.ts) / 60000)
    : null;

  return (
    <>
      {selfReportOpen && (
        <div className="sr-overlay" onClick={onOverlayClick} />
      )}

      <div
        className={`sr-container ${selfReportOpen ? "sr-open" : ""}`}
        style={
          dragOffset !== 0
            ? ({ "--sr-drag": `${dragOffset}px` } as React.CSSProperties)
            : undefined
        }
      >
        {/* Handle */}
        <div
          className="sr-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onHandleClick}
        >
          <StateIcon level={lastSelfReport?.level ?? 3} size={12} />
        </div>

        {/* Panel */}
        <div className="sr-panel">
          <div className="sr-head">
            <div className="sr-title">State</div>
            <button
              className="sr-close"
              onClick={() => setSelfReportOpen(false)}
              aria-label="Close"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path
                  d="M1 1L7 7M7 1L1 7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="sr-subtitle">
            {timeSince !== null && timeSince < 120
              ? `Last: ${lastSelfReport!.label} · ${timeSince}m ago`
              : "Report your current state"}
          </div>

          <div className="sr-levels">
            {LEVELS.map((l) => {
              const isLast =
                lastSelfReport?.level === l.level && confirming === null;
              const isConfirming = confirming === l.level;

              return (
                <button
                  key={l.level}
                  className={`sr-level${isConfirming ? " sr-level-confirming" : ""}${isLast ? " sr-level-last" : ""}`}
                  onClick={() => reportLevel(l.level, l.label)}
                  disabled={confirming !== null}
                >
                  <span className="sr-level-icon">
                    {isConfirming ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          className="sr-check-path"
                          d="M3 7.5L5.5 10L11 4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <StateIcon level={l.level} />
                    )}
                  </span>
                  <span className="sr-level-label">{l.label}</span>
                  <span className="sr-level-desc">{l.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
