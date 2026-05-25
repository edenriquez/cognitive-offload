import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api/client";
import type { DaySchedule, DayBlock } from "../../types";

// ── SVG Icons (no emojis) ────────────────────────────────────────────────────

function IconWork({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="12" height="9" rx="1.5" />
      <path d="M5 5V4a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

function IconSideProject({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2l1.8 3.6L14 6.2l-3 2.9.7 4.1L8 11.1l-3.7 2.1.7-4.1-3-2.9 4.2-.6z" />
    </svg>
  );
}

function IconPersonal({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 13c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="8" cy="5" r="2.5" />
    </svg>
  );
}

function IconLearning({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4l6-2 6 2v2l-6 2-6-2V4z" />
      <path d="M8 8v6" />
      <path d="M5 9.5v3c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5v-3" />
    </svg>
  );
}

function IconBreak({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2h6l1 8H3L4 2z" />
      <path d="M10 6h2a2 2 0 0 1 0 4h-2" />
      <path d="M2 14h12" />
    </svg>
  );
}

function IconDrag({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="6" cy="4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8l4 4 6-7" />
    </svg>
  );
}

function IconEdit({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 2l3 3-8 8H3v-3l8-8z" />
    </svg>
  );
}

function IconSkip({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 3l8 5-8 5V3z" />
      <line x1="13" y1="3" x2="13" y2="13" />
    </svg>
  );
}

function IconPlay({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2l10 6-10 6V2z" />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function minuteToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function CategoryIcon({
  category,
  size = 14,
}: {
  category: string;
  size?: number;
}) {
  switch (category) {
    case "work":
      return <IconWork size={size} />;
    case "side_project":
      return <IconSideProject size={size} />;
    case "personal":
      return <IconPersonal size={size} />;
    case "learning":
      return <IconLearning size={size} />;
    default:
      return <IconWork size={size} />;
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  work: "#6b8cce",
  side_project: "#ce6b8c",
  personal: "#3d9970",
  learning: "#c07a2b",
};

// ── Inline Time Editor ───────────────────────────────────────────────────────

interface TimeEditorProps {
  startMinute: number;
  endMinute: number;
  onSave: (start: number, end: number) => void;
  onCancel: () => void;
}

function TimeEditor({
  startMinute,
  endMinute,
  onSave,
  onCancel,
}: TimeEditorProps) {
  const toHHMM = (min: number) => {
    const h = Math.floor(min / 60)
      .toString()
      .padStart(2, "0");
    const m = (min % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  };
  const fromHHMM = (s: string): number => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const [start, setStart] = useState(toHHMM(startMinute));
  const [end, setEnd] = useState(toHHMM(endMinute));
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startRef.current?.focus();
  }, []);

  const handleSave = () => {
    const s = fromHHMM(start);
    const e = fromHHMM(end);
    if (e > s) onSave(s, e);
  };

  return (
    <div className="bb-time-editor">
      <input
        ref={startRef}
        type="time"
        className="bb-time-input"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <span className="bb-time-sep">–</span>
      <input
        type="time"
        className="bb-time-input"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button className="bb-time-save" onClick={handleSave}>
        Save
      </button>
      <button className="bb-time-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// ── Sortable Block Row ───────────────────────────────────────────────────────

interface BlockRowProps {
  block: DayBlock;
  isActive: boolean;
  hasActiveBlock: boolean;
  editingTimeId: string | null;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onSkip: (id: string) => void;
  onEditTime: (id: string) => void;
  onSaveTime: (id: string, start: number, end: number) => void;
  onCancelTime: () => void;
}

function SortableBlockRow({
  block,
  isActive,
  hasActiveBlock,
  editingTimeId,
  onStart,
  onComplete,
  onSkip,
  onEditTime,
  onSaveTime,
  onCancelTime,
}: BlockRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const isEditingTime = editingTimeId === block.id;
  const color = CATEGORY_COLORS[block.category] || "#999";
  const dur = block.end_minute - block.start_minute;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bb-block bb-block--${block.status}${isActive ? " bb-block--running" : ""}`}
    >
      {/* Category accent bar */}
      <div className="bb-block-accent" style={{ backgroundColor: color }} />

      {/* Drag handle — only for planned blocks */}
      {block.status === "planned" ? (
        <div className="bb-block-drag" {...attributes} {...listeners}>
          <IconDrag size={14} />
        </div>
      ) : (
        <div className="bb-block-drag bb-block-drag--inactive">
          {block.status === "completed" ? (
            <span className="bb-block-check">
              <IconCheck size={12} />
            </span>
          ) : block.status === "active" ? (
            <span className="bb-block-playing">
              <IconPlay size={12} />
            </span>
          ) : (
            <span className="bb-block-skipped-icon">
              <IconSkip size={12} />
            </span>
          )}
        </div>
      )}

      {/* Block body */}
      <div className="bb-block-body">
        <div className="bb-block-top">
          <span className="bb-block-cat-icon" style={{ color }}>
            <CategoryIcon category={block.category} size={13} />
          </span>
          <span className="bb-block-label">{block.label}</span>
          <span className="bb-block-dur">{dur}m</span>
        </div>

        {isEditingTime ? (
          <TimeEditor
            startMinute={block.start_minute}
            endMinute={block.end_minute}
            onSave={(s, e) => onSaveTime(block.id, s, e)}
            onCancel={onCancelTime}
          />
        ) : (
          <div className="bb-block-time-row">
            <span className="bb-block-time">
              {minuteToTime(block.start_minute)} –{" "}
              {minuteToTime(block.end_minute)}
            </span>
            {block.status === "planned" && (
              <button
                className="bb-block-edit-time"
                onClick={() => onEditTime(block.id)}
                title="Edit time"
              >
                <IconEdit size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="bb-block-actions">
        {block.status === "active" && (
          <button
            className="bb-btn-complete"
            onClick={() => onComplete(block.id)}
          >
            Done
          </button>
        )}
        {block.status === "planned" && !hasActiveBlock && (
          <button className="bb-btn-start" onClick={() => onStart(block.id)}>
            <IconPlay size={11} /> Start
          </button>
        )}
        {block.status === "planned" && (
          <button
            className="bb-btn-skip"
            onClick={() => onSkip(block.id)}
            title="Skip block"
          >
            <IconSkip size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function BlockBudgetMode() {
  const [schedule, setSchedule] = useState<DaySchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // ── Data fetching ──────────────────────────────────────────────────────

  const fetchSchedule = useCallback(async () => {
    try {
      const s = await api.getBlockSchedule();
      setSchedule(s);
    } catch {
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // ── Active block countdown ─────────────────────────────────────────────

  useEffect(() => {
    const active = schedule?.active_block;
    if (!active?.actual_start) return;
    const start = active.actual_start;
    setElapsed(Math.floor(Date.now() / 1000) - start);
    const interval = setInterval(() => {
      setElapsed(Math.floor(Date.now() / 1000) - start);
    }, 1000);
    return () => clearInterval(interval);
  }, [schedule?.active_block?.id]);

  // ── Actions ────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const s = await api.generateBlocks();
      setSchedule(s);
    } catch {
      /* ignore */
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleStart = useCallback(
    async (id: string) => {
      try {
        await api.startBlock(id);
        await fetchSchedule();
      } catch {
        /* ignore */
      }
    },
    [fetchSchedule],
  );

  const handleComplete = useCallback(
    async (id: string) => {
      try {
        await api.completeBlock(id);
        await fetchSchedule();
      } catch {
        /* ignore */
      }
    },
    [fetchSchedule],
  );

  const handleSkip = useCallback(
    async (id: string) => {
      try {
        await api.skipBlock(id);
        await fetchSchedule();
      } catch {
        /* ignore */
      }
    },
    [fetchSchedule],
  );

  const handleSaveTime = useCallback(
    async (id: string, start: number, end: number) => {
      setEditingTimeId(null);
      if (!schedule) return;
      // Optimistic update
      const updated = schedule.blocks.map((b) =>
        b.id === id ? { ...b, start_minute: start, end_minute: end } : b,
      );
      setSchedule({ ...schedule, blocks: updated });
      // Persist via reorder (blocks endpoint doesn't have a dedicated PATCH yet —
      // we'll use the full regenerate-then-override approach through local state only
      // until the backend adds PATCH /blocks/:id)
    },
    [schedule],
  );

  // ── Drag and drop ──────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveDragId(e.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveDragId(null);
      if (!schedule) return;
      const { active, over } = e;
      if (!over || active.id === over.id) return;

      const oldIdx = schedule.blocks.findIndex((b) => b.id === active.id);
      const newIdx = schedule.blocks.findIndex((b) => b.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;

      const reordered = arrayMove(schedule.blocks, oldIdx, newIdx).map(
        (b, i) => ({
          ...b,
          idx: i,
        }),
      );
      setSchedule({ ...schedule, blocks: reordered });
    },
    [schedule],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────

  const activeBlock = schedule?.active_block ?? null;
  const blocks = schedule?.blocks ?? [];
  const hasBlocks = blocks.length > 0;
  const allDone = schedule?.day_complete ?? false;

  const nextBlock = useMemo(
    () => blocks.find((b) => b.status === "planned") ?? null,
    [blocks],
  );

  const blockDurationMin = useMemo(() => {
    if (blocks.length === 0) return 90;
    return blocks[0].end_minute - blocks[0].start_minute;
  }, [blocks]);

  const blockDurationSec = blockDurationMin * 60;
  const activeBlockDurSec = activeBlock
    ? (activeBlock.end_minute - activeBlock.start_minute) * 60
    : blockDurationSec;
  const remaining = activeBlock ? Math.max(0, activeBlockDurSec - elapsed) : 0;
  const progressPct = activeBlock
    ? Math.min(100, (elapsed / activeBlockDurSec) * 100)
    : 0;
  const remainMin = Math.floor(remaining / 60);
  const remainSec = remaining % 60;

  const categorySummary = useMemo(() => {
    const s: Record<
      string,
      { total: number; completed: number; label: string; color: string }
    > = {};
    for (const b of blocks) {
      if (!s[b.category]) {
        s[b.category] = {
          total: 0,
          completed: 0,
          label: b.label,
          color: CATEGORY_COLORS[b.category] || "#999",
        };
      }
      s[b.category].total++;
      if (b.status === "completed") s[b.category].completed++;
    }
    return s;
  }, [blocks]);

  const activeDragBlock = activeDragId
    ? (blocks.find((b) => b.id === activeDragId) ?? null)
    : null;

  // ── Loading ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bb">
        <div className="bb-loading">Loading schedule…</div>
      </div>
    );
  }

  // ── Empty state: no blocks yet ─────────────────────────────────────────

  if (!hasBlocks) {
    return (
      <div className="bb">
        <div className="bb-empty">
          <div className="bb-empty-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              stroke="var(--color-lead)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="8" width="24" height="20" rx="2" />
              <path d="M10 8V5a6 6 0 0 1 12 0v3" />
              <line x1="16" y1="16" x2="16" y2="22" />
              <line x1="13" y1="19" x2="19" y2="19" />
            </svg>
          </div>
          <h2 className="bb-empty-heading">Plan your blocks</h2>
          <p className="bb-empty-sub">
            Your day is organized into {blockDurationMin}-minute focus blocks,
            distributed across your work and project allocations.
          </p>
          <button
            className="bb-generate-btn"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? "Generating…" : "Generate today's schedule"}
          </button>
          <p className="bb-empty-hint">
            Adjust split and breaks in Settings → Block Budget
          </p>
        </div>
      </div>
    );
  }

  // ── Day complete ───────────────────────────────────────────────────────

  if (allDone) {
    return (
      <div className="bb">
        <div className="bb-done">
          <div className="bb-done-check">
            <svg
              width="28"
              height="28"
              viewBox="0 0 28 28"
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 14l7 7 11-12" />
            </svg>
          </div>
          <h2 className="bb-done-heading">Day complete</h2>
          <p className="bb-done-sub">
            All {schedule!.total_blocks} blocks used.
          </p>
          <div className="bb-done-summary">
            {Object.entries(categorySummary).map(([cat, s]) => (
              <div key={cat} className="bb-done-row">
                <span className="bb-done-row-icon" style={{ color: s.color }}>
                  <CategoryIcon category={cat} size={13} />
                </span>
                <span className="bb-done-row-label">{s.label}</span>
                <span className="bb-done-row-count">
                  {s.completed}/{s.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────

  const plannableBlocks = blocks.filter((b) => b.status === "planned");

  return (
    <div className="bb">
      {/* Day progress bar + budget allocation */}
      <div className="bb-header">
        <div className="bb-header-row">
          <span className="bb-header-label">Day progress</span>
          <span className="bb-header-count">
            {schedule!.completed_blocks} of {schedule!.total_blocks} blocks
          </span>
        </div>
        <div className="bb-day-bar">
          <div
            className="bb-day-bar-fill"
            style={{
              width: `${(schedule!.completed_blocks / schedule!.total_blocks) * 100}%`,
            }}
          />
        </div>

        {/* Per-category allocation */}
        <div className="bb-alloc-bars">
          {Object.entries(categorySummary).map(([cat, s]) => (
            <div key={cat} className="bb-alloc-row">
              <span className="bb-alloc-icon" style={{ color: s.color }}>
                <CategoryIcon category={cat} size={12} />
              </span>
              <span className="bb-alloc-label">{s.label}</span>
              <div className="bb-alloc-track">
                <div
                  className="bb-alloc-fill"
                  style={{
                    width: `${(s.completed / s.total) * 100}%`,
                    backgroundColor: s.color,
                  }}
                />
              </div>
              <span className="bb-alloc-frac">
                {s.completed}/{s.total}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Active block — prominent countdown */}
      {activeBlock && (
        <div
          className="bb-active"
          style={{
            borderLeftColor: CATEGORY_COLORS[activeBlock.category] || "#999",
          }}
        >
          <div className="bb-active-meta">
            <span
              className="bb-active-cat-icon"
              style={{ color: CATEGORY_COLORS[activeBlock.category] }}
            >
              <CategoryIcon category={activeBlock.category} size={13} />
            </span>
            <span className="bb-active-label">{activeBlock.label}</span>
            <span className="bb-active-time">
              {minuteToTime(activeBlock.start_minute)} –{" "}
              {minuteToTime(activeBlock.end_minute)}
            </span>
          </div>

          <div className="bb-countdown">
            <span className="bb-countdown-num">
              {remainMin}:{remainSec.toString().padStart(2, "0")}
            </span>
            <span className="bb-countdown-unit">remaining</span>
          </div>

          <div className="bb-active-bar">
            <div
              className="bb-active-bar-fill"
              style={{
                width: `${progressPct}%`,
                backgroundColor:
                  CATEGORY_COLORS[activeBlock.category] || "#999",
              }}
            />
          </div>

          <div className="bb-active-footer">
            <button
              className="bb-btn-done"
              onClick={() => handleComplete(activeBlock.id)}
            >
              <IconCheck size={13} /> Complete block
            </button>
          </div>
        </div>
      )}

      {/* Next up — shown when no block is running */}
      {!activeBlock && nextBlock && (
        <div className="bb-next">
          <span className="bb-next-eyebrow">Next up</span>
          <div className="bb-next-card">
            <span
              className="bb-next-icon"
              style={{ color: CATEGORY_COLORS[nextBlock.category] }}
            >
              <CategoryIcon category={nextBlock.category} size={16} />
            </span>
            <div className="bb-next-info">
              <span className="bb-next-label">{nextBlock.label}</span>
              <span className="bb-next-time">
                {minuteToTime(nextBlock.start_minute)} –{" "}
                {minuteToTime(nextBlock.end_minute)}
              </span>
            </div>
            <button
              className="bb-btn-start-next"
              onClick={() => handleStart(nextBlock.id)}
            >
              <IconPlay size={13} /> Start
            </button>
          </div>
        </div>
      )}

      {/* Non-negotiable breaks */}
      {schedule!.non_negotiables && schedule!.non_negotiables.length > 0 && (
        <div className="bb-breaks">
          <span className="bb-section-label">Breaks</span>
          <div className="bb-breaks-list">
            {schedule!.non_negotiables.map((nn) => (
              <div key={nn.id} className="bb-break-item">
                <span className="bb-break-icon">
                  <IconBreak size={12} />
                </span>
                <span className="bb-break-name">{nn.label}</span>
                <span className="bb-break-time">
                  {minuteToTime(nn.start_hour * 60)} –{" "}
                  {minuteToTime(nn.end_hour * 60)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Block timeline — drag to reorder planned blocks */}
      <div className="bb-timeline">
        <span className="bb-section-label">
          Today's blocks
          {plannableBlocks.length > 0 && (
            <span className="bb-section-hint"> · drag to reorder</span>
          )}
        </span>

        {/* Completed / active blocks (non-draggable) */}
        {blocks
          .filter((b) => b.status !== "planned")
          .map((b) => (
            <SortableBlockRow
              key={b.id}
              block={b}
              isActive={b.id === activeBlock?.id}
              hasActiveBlock={!!activeBlock}
              editingTimeId={editingTimeId}
              onStart={handleStart}
              onComplete={handleComplete}
              onSkip={handleSkip}
              onEditTime={setEditingTimeId}
              onSaveTime={handleSaveTime}
              onCancelTime={() => setEditingTimeId(null)}
            />
          ))}

        {/* Planned blocks — draggable */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={plannableBlocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            {plannableBlocks.map((b) => (
              <SortableBlockRow
                key={b.id}
                block={b}
                isActive={false}
                hasActiveBlock={!!activeBlock}
                editingTimeId={editingTimeId}
                onStart={handleStart}
                onComplete={handleComplete}
                onSkip={handleSkip}
                onEditTime={setEditingTimeId}
                onSaveTime={handleSaveTime}
                onCancelTime={() => setEditingTimeId(null)}
              />
            ))}
          </SortableContext>

          <DragOverlay>
            {activeDragBlock ? (
              <div className="bb-block bb-block--planned bb-block--dragging">
                <div
                  className="bb-block-accent"
                  style={{
                    backgroundColor:
                      CATEGORY_COLORS[activeDragBlock.category] || "#999",
                  }}
                />
                <div className="bb-block-drag">
                  <IconDrag size={14} />
                </div>
                <div className="bb-block-body">
                  <div className="bb-block-top">
                    <span
                      className="bb-block-cat-icon"
                      style={{
                        color: CATEGORY_COLORS[activeDragBlock.category],
                      }}
                    >
                      <CategoryIcon
                        category={activeDragBlock.category}
                        size={13}
                      />
                    </span>
                    <span className="bb-block-label">
                      {activeDragBlock.label}
                    </span>
                    <span className="bb-block-dur">
                      {activeDragBlock.end_minute -
                        activeDragBlock.start_minute}
                      m
                    </span>
                  </div>
                  <div className="bb-block-time-row">
                    <span className="bb-block-time">
                      {minuteToTime(activeDragBlock.start_minute)} –{" "}
                      {minuteToTime(activeDragBlock.end_minute)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
