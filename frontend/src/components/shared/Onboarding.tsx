import { useState, useCallback, type ReactNode } from "react";
import { api } from "../../api/client";

// ---------------------------------------------------------------------------
// Time helpers — same 30-min increments as Settings (14:00–22:00)
// ---------------------------------------------------------------------------
function timeOptions(startHour: number, endHour: number) {
  const opts: { value: number; label: string }[] = [];
  for (let h = startHour; h <= endHour; h += 0.5) {
    const hh = Math.floor(h);
    const mm = h % 1 === 0.5 ? "30" : "00";
    const ampm = hh >= 12 ? "PM" : "AM";
    const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
    opts.push({ value: h, label: `${display}:${mm} ${ampm}` });
  }
  return opts;
}

function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = h % 1 === 0.5 ? "30" : "00";
  const ampm = hh >= 12 ? "PM" : "AM";
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${display}:${mm} ${ampm}`;
}

const CUTOFF_OPTIONS = timeOptions(14, 22);
const TOTAL_STEPS = 6;

// ---------------------------------------------------------------------------
// Feature items for Step 2 — minimalist Lucide-style SVG icons
// ---------------------------------------------------------------------------
const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </svg>
    ),
    title: "Block",
    desc: "Your day is divided into 90-minute focus blocks — the natural rhythm of deep work",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
        <path d="M8 11h2l1-3 2 6 1-3h2" />
      </svg>
    ),
    title: "Budget",
    desc: "Set what percentage goes to work vs. side projects — the system enforces the split",
  },
  {
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Protect",
    desc: "When blocks run out, the day is done. Non-negotiable breaks are built into the schedule",
  },
];

// ---------------------------------------------------------------------------
// Decorative bar heights for the energy chart preview (30 bars, 7:00–22:00)
// ---------------------------------------------------------------------------
const SAMPLE_BARS = [
  15,
  35,
  55,
  70,
  80,
  75,
  85,
  60, // morning ramp-up
  30,
  25, // lunch dip
  45,
  65,
  75,
  70,
  55, // afternoon
  40,
  30,
  20,
  15,
  10,
  8,
  5,
  3,
  2,
  1,
  0,
  0,
  0,
  0,
  0, // wind-down
];

// Chart constants
const CHART_W = 400;
const CHART_H = 120;
const CHART_PAD_LEFT = 0;
const CHART_PAD_BOTTOM = 20; // room for x-axis labels
const BAR_AREA_H = CHART_H - CHART_PAD_BOTTOM;
const BAR_COUNT = SAMPLE_BARS.length;
const BAR_GAP = 2;
const BAR_W = (CHART_W - CHART_PAD_LEFT) / BAR_COUNT - BAR_GAP;
const MAX_BAR = Math.max(...SAMPLE_BARS);

// Hours span: 7:00 to 22:00 = 15 hours = 30 half-hour slots
const START_HOUR = 7;
const END_HOUR = 22;

function barX(i: number): number {
  return CHART_PAD_LEFT + i * (BAR_W + BAR_GAP);
}

function cutoffX(cutoff: number): number {
  // cutoff is in fractional hours (e.g. 16.5 = 4:30 PM)
  const fraction = (cutoff - START_HOUR) / (END_HOUR - START_HOUR);
  return CHART_PAD_LEFT + fraction * (CHART_W - CHART_PAD_LEFT);
}

// ---------------------------------------------------------------------------
// Energy chart preview SVG
// ---------------------------------------------------------------------------
function EnergyChartPreview({ cutoffHour }: { cutoffHour: number }) {
  const cx = cutoffX(cutoffHour);
  const label = formatHour(cutoffHour);

  return (
    <svg
      className="onboarding-chart"
      width={CHART_W}
      height={CHART_H}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
    >
      {/* Decorative sample bars */}
      {SAMPLE_BARS.map((h, i) => {
        const x = barX(i);
        const barH = MAX_BAR > 0 ? (h / MAX_BAR) * (BAR_AREA_H - 10) : 0;
        const y = BAR_AREA_H - barH;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={BAR_W}
            height={barH}
            rx={2}
            fill="#e5e7eb"
          />
        );
      })}

      {/* Red tint overlay to the right of cutoff */}
      <rect
        x={cx}
        y={0}
        width={Math.max(0, CHART_W - cx)}
        height={BAR_AREA_H}
        fill="rgba(123, 35, 34, 0.06)"
      />

      {/* Cutoff dashed line */}
      <line
        x1={cx}
        y1={0}
        x2={cx}
        y2={BAR_AREA_H}
        stroke="#7b2322"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />

      {/* Cutoff label */}
      <text
        x={cx}
        y={-4}
        textAnchor="middle"
        fill="#7b2322"
        fontSize="11"
        fontWeight="600"
        dominantBaseline="auto"
        className="onboarding-chart-label"
      >
        {label}
      </text>

      {/* X-axis hour labels */}
      {[7, 10, 13, 16, 19, 22].map((hr) => {
        const x = cutoffX(hr);
        const ampm = hr >= 12 ? "PM" : "AM";
        const display = hr > 12 ? hr - 12 : hr;
        return (
          <text
            key={hr}
            x={x}
            y={CHART_H - 4}
            textAnchor="middle"
            fill="#6b7280"
            fontSize="10"
          >
            {display}
            {ampm}
          </text>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Onboarding() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem("cogload_onboarded") !== "true",
  );
  const [step, setStep] = useState(0);
  const [fade, setFade] = useState(true);

  // Quick-setup state
  const [cutoffHour, setCutoffHour] = useState(16.5);

  // Block budget setup state
  const [allocations, setAllocations] = useState([
    { category: "work", pct: 60, label: "Main Work", color: "#6b8cce" },
    {
      category: "side_project",
      pct: 40,
      label: "Side Project",
      color: "#ce6b8c",
    },
  ]);
  const [breaks, setBreaks] = useState([
    {
      id: "lunch",
      label: "Lunch",
      start_hour: 12.0,
      end_hour: 13.0,
      days: [] as number[],
    },
  ]);
  const [newBreakLabel, setNewBreakLabel] = useState("");
  const [newBreakStart, setNewBreakStart] = useState(12.0);
  const [newBreakEnd, setNewBreakEnd] = useState(13.0);
  const [workdayStart, setWorkdayStart] = useState(9.0);
  const [workdayEnd, setWorkdayEnd] = useState(17.0);

  // Smooth transition between steps
  const goTo = useCallback((next: number) => {
    setFade(false);
    setTimeout(() => {
      setStep(next);
      setFade(true);
    }, 200);
  }, []);

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      // Persist cutoff when leaving step 2
      if (step === 2) {
        api.updateConfig({ cutoff_hour: cutoffHour }).catch(() => {});
      }
      // Persist block config when leaving step 4 (breaks step)
      if (step === 4) {
        api
          .updateBlockConfig({
            block_duration_min: 90,
            workday_start_hour: workdayStart,
            workday_end_hour: workdayEnd,
            allocations: allocations,
            non_negotiables: breaks,
          })
          .catch(() => {});
      }
      goTo(step + 1);
    }
  }, [step, cutoffHour, workdayStart, workdayEnd, allocations, breaks, goTo]);

  const handleFinish = useCallback(() => {
    localStorage.setItem("cogload_onboarded", "true");
    setFade(false);
    setTimeout(() => setVisible(false), 250);
  }, []);

  if (!visible) return null;

  return (
    <div className="onboarding-overlay">
      <div
        className={`onboarding-content ${fade ? "onboarding-fade-in" : "onboarding-fade-out"}`}
      >
        {/* Step 1 — Welcome */}
        {step === 0 && (
          <>
            <h1 className="onboarding-heading">Welcome to Cogload</h1>
            <p className="onboarding-body">
              Your cognitive load monitor. Track focus, detect overload
              patterns, and protect your deep work.
            </p>
            <button className="onboarding-btn" onClick={handleNext}>
              Get started →
            </button>
          </>
        )}

        {/* Step 2 — How it works */}
        {step === 1 && (
          <>
            <h1 className="onboarding-heading">How it works</h1>
            <div className="onboarding-features">
              {FEATURES.map((f) => (
                <div key={f.title} className="onboarding-feature">
                  <span className="onboarding-feature-icon">{f.icon}</span>
                  <span className="onboarding-feature-text">
                    <b>{f.title}</b> — {f.desc}
                  </span>
                </div>
              ))}
            </div>
            <button className="onboarding-btn" onClick={handleNext}>
              Next →
            </button>
          </>
        )}

        {/* Step 3 — Quick setup */}
        {step === 2 && (
          <>
            <h1 className="onboarding-heading">Set your cutoff hour</h1>
            <p className="onboarding-explanation">
              The cutoff hour is when Cogload starts protecting you from
              overwork. Past this time, new complex work is discouraged and
              you'll be guided to close open loops and stop for the day.
            </p>

            <EnergyChartPreview cutoffHour={cutoffHour} />

            <div className="onboarding-setup">
              <div className="onboarding-setup-row">
                <label className="onboarding-setup-label">Cutoff hour</label>
                <select
                  className="onboarding-select"
                  value={cutoffHour}
                  onChange={(e) => setCutoffHour(parseFloat(e.target.value))}
                >
                  {CUTOFF_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="onboarding-btn" onClick={handleNext}>
              Next →
            </button>
          </>
        )}

        {/* Step 4 — Allocation */}
        {step === 3 && (
          <>
            <h1 className="onboarding-heading">Split your time</h1>
            <p className="onboarding-explanation">
              What percentage of your blocks should go to each type of work?
              Drag to adjust — the system will distribute blocks accordingly.
            </p>

            <div className="onboarding-allocations">
              {allocations.map((a, i) => (
                <div key={a.category} className="onboarding-alloc-row">
                  <div className="onboarding-alloc-header">
                    <input
                      className="onboarding-alloc-label-input"
                      value={a.label}
                      onChange={(e) => {
                        const next = [...allocations];
                        next[i] = { ...next[i], label: e.target.value };
                        setAllocations(next);
                      }}
                      placeholder="Label"
                    />
                    <span className="onboarding-alloc-pct">{a.pct}%</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={a.pct}
                    className="onboarding-alloc-slider"
                    style={{ accentColor: a.color }}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const next = [...allocations];
                      next[i] = { ...next[i], pct: val };
                      // Adjust the other to balance to 100
                      if (allocations.length === 2) {
                        const other = i === 0 ? 1 : 0;
                        next[other] = { ...next[other], pct: 100 - val };
                      }
                      setAllocations(next);
                    }}
                  />
                  <div
                    className="onboarding-alloc-preview"
                    style={{ backgroundColor: a.color, width: `${a.pct}%` }}
                  />
                </div>
              ))}
            </div>

            <div className="onboarding-workday-row">
              <label className="onboarding-setup-label">Workday</label>
              <select
                className="onboarding-select"
                value={workdayStart}
                onChange={(e) => setWorkdayStart(parseFloat(e.target.value))}
              >
                {timeOptions(6, 12).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="onboarding-to">to</span>
              <select
                className="onboarding-select"
                value={workdayEnd}
                onChange={(e) => setWorkdayEnd(parseFloat(e.target.value))}
              >
                {timeOptions(14, 22).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <button className="onboarding-btn" onClick={handleNext}>
              Next →
            </button>
          </>
        )}

        {/* Step 5 — Breaks */}
        {step === 4 && (
          <>
            <h1 className="onboarding-heading">Non-negotiable breaks</h1>
            <p className="onboarding-explanation">
              Add fixed commitments that blocks can't be scheduled over — lunch,
              standups, meetings, gym, etc.
            </p>

            <div className="onboarding-breaks">
              {breaks.map((b, i) => (
                <div key={b.id} className="onboarding-break-row">
                  <span className="onboarding-break-label">{b.label}</span>
                  <span className="onboarding-break-time">
                    {formatHour(b.start_hour)} – {formatHour(b.end_hour)}
                  </span>
                  <button
                    className="onboarding-break-remove"
                    onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="onboarding-break-add">
                <input
                  className="onboarding-break-input"
                  placeholder="Break name (e.g. Standup)"
                  value={newBreakLabel}
                  onChange={(e) => setNewBreakLabel(e.target.value)}
                />
                <select
                  className="onboarding-select onboarding-select-sm"
                  value={newBreakStart}
                  onChange={(e) => setNewBreakStart(parseFloat(e.target.value))}
                >
                  {timeOptions(6, 22).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="onboarding-to">to</span>
                <select
                  className="onboarding-select onboarding-select-sm"
                  value={newBreakEnd}
                  onChange={(e) => setNewBreakEnd(parseFloat(e.target.value))}
                >
                  {timeOptions(6, 22).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  className="onboarding-break-add-btn"
                  disabled={!newBreakLabel.trim()}
                  onClick={() => {
                    if (!newBreakLabel.trim()) return;
                    setBreaks([
                      ...breaks,
                      {
                        id: `break-${Date.now()}`,
                        label: newBreakLabel.trim(),
                        start_hour: newBreakStart,
                        end_hour: newBreakEnd,
                        days: [],
                      },
                    ]);
                    setNewBreakLabel("");
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <button className="onboarding-btn" onClick={handleNext}>
              Almost done →
            </button>
          </>
        )}

        {/* Step 6 — Ready */}
        {step === 5 && (
          <>
            <h1 className="onboarding-heading">You're all set</h1>
            <p className="onboarding-body">
              Your day is divided into focus blocks. Generate your schedule each
              morning and work through them. When blocks run out, you're done.
            </p>
            <button className="onboarding-btn" onClick={handleFinish}>
              Start working →
            </button>
          </>
        )}

        {/* Step dots */}
        <div className="onboarding-dots">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`onboarding-dot ${i === step ? "active" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
