import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import dagre from "@dagrejs/dagre";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../../api/client";
import { useAppStore } from "../../store/app-store";
import type { Task, TaskEdge, TaskGraph } from "../../types";
import TaskNode, {
  type TaskNodeData,
  type TaskNodeType,
} from "../shared/TaskNode";

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_W = 240;
const NODE_H = 72;
const nodeTypes = { task: TaskNode } as const;

type LayoutDirection = "free" | "LR";

// ── Icons ──────────────────────────────────────────────────────────────────────

function IconLayout() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function IconClear() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function IconSubtask() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h8M4 8h6M4 12h4" />
    </svg>
  );
}

function IconUnlink() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 11l6-6" strokeDasharray="2 2" />
      <path d="M3 13l2-2M11 3l2-2" />
    </svg>
  );
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function nowHour(): number {
  const n = new Date();
  return n.getHours() + n.getMinutes() / 60;
}

function isTaskLocked(
  task: { kind: string },
  hour: number,
  lunchStart: number,
  lunchEnd: number,
  cutoffHour: number,
): "lunch" | "cutoff" | null {
  if (hour >= lunchStart && hour < lunchEnd) return "lunch";
  if (hour >= cutoffHour && task.kind === "must") return "cutoff";
  return null;
}

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h % 1) * 60);
  const ampm = hh >= 12 ? "PM" : "AM";
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return mm > 0
    ? `${display}:${String(mm).padStart(2, "0")} ${ampm}`
    : `${display} ${ampm}`;
}

function fmtAccum(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DURATION_PRESETS = [
  { label: "15m", secs: 900 },
  { label: "30m", secs: 1800 },
  { label: "45m", secs: 2700 },
  { label: "1h", secs: 3600 },
  { label: "1.5h", secs: 5400 },
  { label: "2h", secs: 7200 },
];

const CATEGORY_FOR_KIND: Record<string, string> = {
  must: "work",
  personal: "side_project",
  small: "work",
};

// sessionStorage time accumulator
const TIME_STORAGE_KEY = "cogload_time_today";

function loadAccumulated(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(TIME_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveAccumulated(acc: Record<string, number>) {
  try {
    sessionStorage.setItem(TIME_STORAGE_KEY, JSON.stringify(acc));
  } catch {}
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const POS_KEY_FREE = "cogload_map_pos_free";

function loadFreePositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY_FREE) ?? "{}") as Record<
      string,
      { x: number; y: number }
    >;
  } catch {
    return {};
  }
}

function saveFreePositions(pos: Record<string, { x: number; y: number }>) {
  localStorage.setItem(POS_KEY_FREE, JSON.stringify(pos));
}

function dagreLayout(
  tasks: Task[],
  edges: TaskEdge[],
  direction: "LR" | "TB",
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 40 : 60,
    ranksep: direction === "LR" ? 100 : 80,
    marginx: 40,
    marginy: 40,
  });

  tasks.forEach((t) => g.setNode(t.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source_id, e.target_id));

  dagre.layout(g);

  const pos: Record<string, { x: number; y: number }> = {};
  tasks.forEach((t) => {
    const node = g.node(t.id);
    if (node) {
      // dagre centres nodes — convert to top-left origin for React Flow
      pos[t.id] = { x: node.x - NODE_W / 2, y: node.y - NODE_H / 2 };
    }
  });
  return pos;
}

function toFlowEdge(e: TaskEdge): Edge {
  const isBlocks = e.kind === "blocks";
  return {
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: "smoothstep",
    animated: false,
    style: {
      stroke: isBlocks ? "var(--color-carbon)" : "var(--color-lead)",
      strokeWidth: 1.5,
      strokeDasharray: isBlocks ? undefined : "5 4",
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 12,
      height: 12,
      color: isBlocks ? "var(--color-carbon)" : "var(--color-lead)",
    },
    data: { kind: e.kind },
  };
}

// ── Day Timeline strip ────────────────────────────────────────────────────────────────────

function DayTimeline({
  now,
  workdayStart,
  workdayEnd,
  lunchStart,
  lunchEnd,
  cutoffHour,
}: {
  now: Date;
  workdayStart: number;
  workdayEnd: number;
  lunchStart: number;
  lunchEnd: number;
  cutoffHour: number;
}) {
  const span = workdayEnd - workdayStart;
  const toX = (h: number) =>
    `${Math.max(0, Math.min(100, ((h - workdayStart) / span) * 100))}%`;

  const nowH = now.getHours() + now.getMinutes() / 60;
  const isLunch = nowH >= lunchStart && nowH < lunchEnd;
  const isPastCutoff = nowH >= cutoffHour;

  const tickHours: number[] = [];
  for (let h = Math.ceil(workdayStart); h <= workdayEnd; h++) {
    tickHours.push(h);
  }

  return (
    <div className="day-timeline" aria-hidden="true">
      {/* Lunch band */}
      <div
        className={`day-tl-band day-tl-band--lunch${isLunch ? " day-tl-band--blink" : ""}`}
        style={{
          left: toX(lunchStart),
          width: `calc(${toX(lunchEnd)} - ${toX(lunchStart)})`,
        }}
      />

      {/* Post-cutoff band */}
      {isPastCutoff && (
        <div
          className="day-tl-band day-tl-band--cutoff"
          style={{ left: toX(cutoffHour), right: 0 }}
        />
      )}

      {/* Hour ticks */}
      {tickHours.map((h) => (
        <div key={h} className="day-tl-tick" style={{ left: toX(h) }}>
          <span className="day-tl-tick-label">{fmtHour(h)}</span>
        </div>
      ))}

      {/* Cutoff marker */}
      <div className="day-tl-cutoff-line" style={{ left: toX(cutoffHour) }}>
        <span className="day-tl-cutoff-label">cutoff</span>
      </div>

      {/* Now caret */}
      {nowH >= workdayStart && nowH <= workdayEnd && (
        <div
          className={`day-tl-now${isPastCutoff ? " day-tl-now--over" : ""}`}
          style={{ left: toX(nowH) }}
        >
          <span className="day-tl-now-label">{fmtHour(nowH)}</span>
        </div>
      )}

      {/* Lunch label */}
      {isLunch && (
        <div
          className="day-tl-lunch-label"
          style={{ left: `calc(${toX(lunchStart)} + 4px)` }}
        >
          Lunch break
        </div>
      )}
    </div>
  );
}

// ── Edge kind popover ────────────────────────────────────────────────────────────────────

function EdgePopover({
  x,
  y,
  onPick,
  onCancel,
}: {
  x: number;
  y: number;
  onPick: (kind: "blocks" | "subtask") => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="map-popover-backdrop" onClick={onCancel} />
      <div className="map-popover" style={{ left: x, top: y }}>
        <div className="map-popover-label">Link type</div>
        <button className="map-popover-btn" onClick={() => onPick("blocks")}>
          <span className="map-popover-icon map-popover-icon--blocks">
            <IconArrowRight />
          </span>
          <span className="map-popover-btn-content">
            <span className="map-popover-btn-name">Blocks</span>
            <span className="map-popover-btn-desc">
              A must finish before B starts
            </span>
          </span>
        </button>
        <button className="map-popover-btn" onClick={() => onPick("subtask")}>
          <span className="map-popover-icon map-popover-icon--subtask">
            <IconSubtask />
          </span>
          <span className="map-popover-btn-content">
            <span className="map-popover-btn-name">Subtask of</span>
            <span className="map-popover-btn-desc">B is a piece of A</span>
          </span>
        </button>
      </div>
    </>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function DetailPanel({
  task,
  edges,
  tasks,
  onDeleteEdge,
  onClose,
}: {
  task: Task;
  edges: TaskEdge[];
  tasks: Task[];
  onDeleteEdge: (id: string) => void;
  onClose: () => void;
}) {
  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const blockedBy = edges.filter(
    (e) => e.target_id === task.id && e.kind === "blocks",
  );
  const blocking = edges.filter(
    (e) => e.source_id === task.id && e.kind === "blocks",
  );
  const subtasks = edges.filter(
    (e) => e.source_id === task.id && e.kind === "subtask",
  );
  const parentOf = edges.filter(
    (e) => e.target_id === task.id && e.kind === "subtask",
  );
  const hasEdges =
    blockedBy.length + blocking.length + subtasks.length + parentOf.length > 0;

  return (
    <div className="map-detail">
      <div className="map-detail-header">
        <span className={`map-detail-kind map-detail-kind--${task.kind}`}>
          {task.kind}
        </span>
        <button className="map-detail-close" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      <p
        className={`map-detail-text${task.done ? " map-detail-text--done" : ""}`}
      >
        {task.text}
      </p>

      {blockedBy.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">
            <span className="map-detail-section-icon">
              <IconArrowRight />
            </span>
            Blocked by
          </div>
          {blockedBy.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.source_id]?.text ?? "—"}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove"
              >
                <IconUnlink />
              </button>
            </div>
          ))}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">
            <span className="map-detail-section-icon">
              <IconArrowRight />
            </span>
            Blocks
          </div>
          {blocking.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.target_id]?.text ?? "—"}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove"
              >
                <IconUnlink />
              </button>
            </div>
          ))}
        </div>
      )}

      {subtasks.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">
            <span className="map-detail-section-icon">
              <IconSubtask />
            </span>
            Subtasks
          </div>
          {subtasks.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.target_id]?.text ?? "—"}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove"
              >
                <IconUnlink />
              </button>
            </div>
          ))}
        </div>
      )}

      {parentOf.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">
            <span className="map-detail-section-icon">
              <IconSubtask />
            </span>
            Subtask of
          </div>
          {parentOf.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.source_id]?.text ?? "—"}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove"
              >
                <IconUnlink />
              </button>
            </div>
          ))}
        </div>
      )}

      {!hasEdges && (
        <div className="map-detail-empty">
          No links yet. Drag from the handle on the right edge of a node to
          connect.
        </div>
      )}
    </div>
  );
}

// ── Insert intermediate task popover ──────────────────────────────────────────

function InsertOnEdgePopover({
  x,
  y,
  onInsert,
  onCancel,
}: {
  x: number;
  y: number;
  onInsert: (
    text: string,
    kind: "must" | "personal" | "small",
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"must" | "personal" | "small">("must");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Small delay so the dblclick doesn't immediately steal focus elsewhere
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await onInsert(text.trim(), kind);
    } finally {
      setSaving(false);
    }
  };

  // Clamp popover to viewport
  const PW = 220;
  const PH = 160;
  const left = Math.min(Math.max(x - PW / 2, 8), window.innerWidth - PW - 8);
  const top = Math.min(Math.max(y - PH / 2, 8), window.innerHeight - PH - 8);

  return (
    <>
      <div className="map-popover-backdrop" onClick={onCancel} />
      <div className="map-edge-insert" style={{ left, top }}>
        <div className="map-edge-insert-label">Insert intermediate task</div>
        <div className="map-edge-insert-kinds">
          {(["must", "personal", "small"] as const).map((k) => (
            <button
              key={k}
              className={`map-edge-insert-kind${
                kind === k ? " map-edge-insert-kind--on" : ""
              }`}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          className="map-edge-insert-input"
          placeholder="New task name…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <button
          className="map-edge-insert-submit"
          onClick={handleSubmit}
          disabled={!text.trim() || saving}
        >
          {saving ? "Inserting…" : "Insert between"}
        </button>
      </div>
    </>
  );
}

// ── Ambient sidebar (nothing selected) ────────────────────────────────────────────────────────────

type BlockConfigShape = {
  allocations: {
    category: string;
    label: string;
    color: string;
    pct: number;
  }[];
  workday_start_hour: number;
  workday_end_hour: number;
};

function AmbientSidebar({
  accumulated,
  blockConfig,
  allTasks,
  now,
  lunchStart,
  lunchEnd,
  cutoffHour,
  onSelectHint,
}: {
  accumulated: Record<string, number>;
  blockConfig: BlockConfigShape | null;
  allTasks: Task[];
  now: Date;
  lunchStart: number;
  lunchEnd: number;
  cutoffHour: number;
  onSelectHint?: string;
}) {
  const nowH = now.getHours() + now.getMinutes() / 60;
  const isLunch = nowH >= lunchStart && nowH < lunchEnd;
  const isPastCutoff = nowH >= cutoffHour;

  const workdayHours = blockConfig
    ? blockConfig.workday_end_hour - blockConfig.workday_start_hour
    : 8;
  const workdaySecs = workdayHours * 3600;

  const allocs = blockConfig?.allocations ?? [
    { category: "work", label: "Work", color: "#6b8cce", pct: 60 },
    {
      category: "side_project",
      label: "Side project",
      color: "#ce6b8c",
      pct: 40,
    },
  ];

  const rows = allocs.filter(
    (a) => a.category === "work" || a.category === "side_project",
  );

  return (
    <div className="mcp mcp--ambient">
      {/* Status indicator */}
      {isLunch && (
        <div className="mcp-lunch-card">
          <div className="mcp-lunch-title">Lunch break</div>
          <div className="mcp-lunch-until">Resumes at {fmtHour(lunchEnd)}</div>
        </div>
      )}
      {!isLunch && isPastCutoff && (
        <div className="mcp-cutoff-card">
          <div className="mcp-cutoff-title">Work time done</div>
          <div className="mcp-cutoff-sub">Side project tasks only</div>
        </div>
      )}

      {/* Budget bars — task counts by category */}
      <div className="mcp-section">
        <div className="mcp-section-label">Today's progress</div>
        {rows.map((a) => {
          // Tasks belonging to this category
          const catKinds =
            a.category === "work"
              ? ["must", "small"]
              : a.category === "side_project"
                ? ["personal"]
                : [];
          const catTasks = allTasks.filter((t) => catKinds.includes(t.kind));
          const total = catTasks.length;
          const done = catTasks.filter((t) => t.done).length;
          const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
          return (
            <div key={a.category} className="mcp-budget-row">
              <div className="mcp-budget-header">
                <span className="mcp-budget-label">{a.label}</span>
                <span className="mcp-budget-value">
                  {done}/{total} tasks
                </span>
              </div>
              <div className="mcp-budget-track">
                <div
                  className="mcp-budget-fill"
                  style={{ width: `${pct}%`, backgroundColor: a.color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Day info */}
      <div className="mcp-section">
        <div className="mcp-section-label">Day info</div>
        <div className="mcp-info-row">
          <span className="mcp-info-key">Time of day</span>
          <span className="mcp-info-val">{fmtHour(nowH)}</span>
        </div>
        <div className="mcp-info-row">
          <span className="mcp-info-key">Workday ends</span>
          <span className="mcp-info-val">{fmtHour(cutoffHour)}</span>
        </div>
        <div className="mcp-info-row">
          <span className="mcp-info-key">Lunch</span>
          <span className="mcp-info-val">
            {fmtHour(lunchStart)}–{fmtHour(lunchEnd)}
          </span>
        </div>
      </div>

      {/* Hint */}
      <div className="mcp-hint">
        {onSelectHint ?? "Select a task to start focusing"}
      </div>
    </div>
  );
}

// ── Task control panel (node selected) ────────────────────────────────────────────────────────────

function TaskControlPanel({
  task,
  edges,
  tasks,
  allTasks,
  focus,
  accumulated,
  blockConfig,
  locked,
  onStartFocus,
  onPauseFocus,
  onCompleteFocus,
  onDeleteEdge,
  onDeleteTask,
  onSelectTask,
  onClose,
}: {
  task: Task;
  edges: TaskEdge[];
  tasks: Task[];
  allTasks: Task[];
  focus: { task: string | null; remainingSecs: number; isPaused: boolean };
  accumulated: Record<string, number>;
  blockConfig: BlockConfigShape | null;
  locked: "lunch" | "cutoff" | null;
  onStartFocus: (taskId: string, durationSecs: number) => void;
  onPauseFocus: () => void;
  onCompleteFocus: (taskId: string) => void;
  onDeleteEdge: (id: string) => void;
  onDeleteTask: (taskId: string) => void;
  onSelectTask: (id: string) => void;
  onClose: () => void;
}) {
  const [durIdx, setDurIdx] = useState(4); // default 1.5h = index 4
  const isThisTaskFocused = focus.task === task.text;
  const isRunning = isThisTaskFocused && !focus.isPaused;
  const isPaused = isThisTaskFocused && focus.isPaused;

  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const blockedBy = edges.filter(
    (e) => e.target_id === task.id && e.kind === "blocks",
  );
  const blocking = edges.filter(
    (e) => e.source_id === task.id && e.kind === "blocks",
  );

  const category = CATEGORY_FOR_KIND[task.kind] ?? "work";
  const alloc = blockConfig?.allocations.find((a) => a.category === category);

  // Task count progress for this task's category
  const catKinds =
    category === "work"
      ? ["must", "small"]
      : category === "side_project"
        ? ["personal"]
        : [];
  const catTasks = allTasks.filter((t) => catKinds.includes(t.kind));
  const catTotal = catTasks.length;
  const catDone = catTasks.filter((t) => t.done).length;
  const budgetPct =
    catTotal > 0 ? Math.min(100, (catDone / catTotal) * 100) : 0;

  const totalDur = DURATION_PRESETS[durIdx]?.secs ?? 5400;
  const elapsed = isThisTaskFocused ? totalDur - focus.remainingSecs : 0;
  const progressPct = isThisTaskFocused
    ? Math.min(100, (elapsed / totalDur) * 100)
    : 0;

  return (
    <div className="mcp">
      {/* Header */}
      <div className="mcp-header">
        <button className="mcp-back" onClick={onClose}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
        <span className={`mcp-kind mcp-kind--${task.kind}`}>{task.kind}</span>
        <button
          className="mcp-delete-btn"
          onClick={() => onDeleteTask(task.id)}
          title="Delete task"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
            <path d="M5 4l.5 9h5l.5-9" />
          </svg>
        </button>
      </div>

      <div className="mcp-task-name">{task.text}</div>

      {/* Lunch lock */}
      {locked === "lunch" && (
        <div className="mcp-lock-card mcp-lock-card--lunch">
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" />
          </svg>
          Paused for lunch break
        </div>
      )}

      {/* Cutoff lock */}
      {locked === "cutoff" && (
        <div className="mcp-lock-card mcp-lock-card--cutoff">
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" />
          </svg>
          Work time ended — switch to personal tasks
        </div>
      )}

      {/* Timer block */}
      {!locked && (
        <>
          {isThisTaskFocused ? (
            <div className="mcp-timer-block">
              <div className="mcp-countdown">
                {fmtSecs(focus.remainingSecs)}
              </div>
              <div className="mcp-timer-meta">
                remaining of {DURATION_PRESETS[durIdx]?.label ?? "—"}
              </div>
              <div className="mcp-timer-track">
                <div
                  className="mcp-timer-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="mcp-duration-block">
              <div className="mcp-duration-label">Focus duration</div>
              <div className="mcp-duration-presets">
                {DURATION_PRESETS.map((p, i) => (
                  <button
                    key={p.secs}
                    className={`mcp-preset${durIdx === i ? " mcp-preset--on" : ""}`}
                    onClick={() => setDurIdx(i)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action button */}
          <div className="mcp-actions">
            {isRunning ? (
              <>
                <button
                  className="mcp-btn mcp-btn--pause"
                  onClick={onPauseFocus}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M5 3v10M11 3v10" />
                  </svg>
                  Pause
                </button>
                <button
                  className="mcp-btn mcp-btn--done"
                  onClick={() => onCompleteFocus(task.id)}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 8l4 4 6-7" />
                  </svg>
                  Done
                </button>
              </>
            ) : (
              <button
                className="mcp-btn mcp-btn--start"
                onClick={() =>
                  onStartFocus(task.id, DURATION_PRESETS[durIdx]?.secs ?? 5400)
                }
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 2l10 6-10 6V2z" />
                </svg>
                {isPaused ? "Resume" : "Start"}
              </button>
            )}
          </div>
        </>
      )}

      {/* Category task progress */}
      {alloc && catTotal > 0 && (
        <div className="mcp-section mcp-section--budget">
          <div className="mcp-section-label">Today on {alloc.label}</div>
          <div className="mcp-budget-header">
            <span />
            <span className="mcp-budget-value">
              {catDone}/{catTotal} tasks
            </span>
          </div>
          <div className="mcp-budget-track">
            <div
              className="mcp-budget-fill"
              style={{ width: `${budgetPct}%`, backgroundColor: alloc.color }}
            />
          </div>
        </div>
      )}

      {/* Dependencies */}
      {blockedBy.length > 0 && (
        <div className="mcp-section">
          <div className="mcp-section-label">Blocked by</div>
          {blockedBy.map((e) => {
            const t = taskMap[e.source_id];
            return t ? (
              <button
                key={e.id}
                className="mcp-dep-row"
                onClick={() => onSelectTask(t.id)}
              >
                <span className="mcp-dep-text">{t.text}</span>
                <span className="mcp-dep-arrow">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                </span>
              </button>
            ) : null;
          })}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mcp-section">
          <div className="mcp-section-label">Unlocks</div>
          {blocking.map((e) => {
            const t = taskMap[e.target_id];
            return t ? (
              <button
                key={e.id}
                className="mcp-dep-row"
                onClick={() => onSelectTask(t.id)}
              >
                <span className="mcp-dep-text">{t.text}</span>
                <span className="mcp-dep-arrow">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                </span>
              </button>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

// ── Add Task panel ────────────────────────────────────────────────────────────────────

function AddTaskPanel({
  onAdd,
  onClose,
}: {
  onAdd: (text: string, kind: "must" | "personal" | "small") => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"must" | "personal" | "small">("must");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    await onAdd(text.trim(), kind);
    setText("");
    setSaving(false);
    inputRef.current?.focus();
  };

  return (
    <div className="map-add-panel">
      <div className="map-add-header">
        <span className="map-add-title">Add task</span>
        <button className="map-add-close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="map-add-kinds">
        {(["must", "personal", "small"] as const).map((k) => (
          <button
            key={k}
            className={`map-add-kind${kind === k ? " map-add-kind--on" : ""}`}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        className="map-add-input"
        placeholder="Task name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onClose();
        }}
      />
      <button
        className="map-add-submit"
        onClick={handleSubmit}
        disabled={!text.trim() || saving}
      >
        {saving ? "Adding…" : "Add to map"}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MapMode() {
  const { focus, startFocus, pauseFocus, exitFocus } = useAppStore();

  const [graph, setGraph] = useState<TaskGraph | null>(null);
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rawEdges, setRawEdges] = useState<TaskEdge[]>([]);
  const [rawTasks, setRawTasks] = useState<Task[]>([]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingConn, setPendingConn] = useState<{
    source: string;
    target: string;
    x: number;
    y: number;
  } | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [layoutDir, setLayoutDir] = useState<LayoutDirection>("LR");
  const [insertOnEdge, setInsertOnEdge] = useState<{
    edgeId: string;
    sourceId: string;
    targetId: string;
    kind: "blocks" | "subtask";
    x: number;
    y: number;
  } | null>(null);

  // ── New state: time tracking, config, clock ──────────────────────────────────────────

  const [accumulated, setAccumulated] =
    useState<Record<string, number>>(loadAccumulated);
  const [blockConfig, setBlockConfig] = useState<BlockConfigShape | null>(null);
  const [lunchStart, setLunchStart] = useState(12.5);
  const [lunchEnd, setLunchEnd] = useState(13.5);
  const [cutoffHour, setCutoffHour] = useState(16.5);
  const [currentTime, setCurrentTime] = useState(new Date());

  // ── Build nodes ────────────────────────────────────────────────────────────────────

  const buildNodes = useCallback(
    (
      g: TaskGraph,
      readySet: Set<string>,
      pos: Record<string, { x: number; y: number }>,
      focusTask: string | null,
    ): TaskNodeType[] =>
      g.tasks.map(
        (task, i): TaskNodeType => ({
          id: task.id,
          type: "task",
          position: pos[task.id] ?? {
            x: (i % 4) * (NODE_W + 60),
            y: Math.floor(i / 4) * (NODE_H + 60),
          },
          data: {
            task,
            estimate: undefined,
            isReady: readySet.has(task.id),
            isFocused: focusTask === task.text,
            isPaused: false,
            locked: null,
          },
        }),
      ),
    [],
  );

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [g, ready] = await Promise.all([
          api.getTaskGraph(),
          api.getReadyTasks(),
        ]);
        if (cancelled) return;
        const readySet = new Set(ready.ready);
        setGraph(g);
        setRawTasks(g.tasks);
        setRawEdges(g.edges);
        setReadyIds(readySet);
        const savedFree = loadFreePositions();
        const hasSavedFree = g.tasks.some((t) => savedFree[t.id]);
        // Free positions exist → use them (and start in free mode)
        // Otherwise default to LR dagre (no positions written until user drags)
        const pos = hasSavedFree
          ? savedFree
          : dagreLayout(g.tasks, g.edges, "LR");
        if (hasSavedFree) setLayoutDir("free");
        setNodes(buildNodes(g, readySet, pos, focus.task));
        setEdges(g.edges.map(toFlowEdge));
      } catch {
        if (!cancelled)
          setError("Could not load task graph. Is the backend running?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch block config + app config on mount ──────────────────────────────────

  useEffect(() => {
    api
      .getBlockConfig()
      .then(setBlockConfig)
      .catch(() => {});
    api
      .getConfig()
      .then((c) => {
        if (c.lunch_start) setLunchStart(c.lunch_start);
        if (c.lunch_end) setLunchEnd(c.lunch_end);
        if (c.cutoff_hour) setCutoffHour(c.cutoff_hour);
      })
      .catch(() => {});
  }, []);

  // ── Clock tick ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Time accumulator ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!focus.task || focus.isPaused) return;
    const runningTask = rawTasks.find((t) => t.text === focus.task);
    if (!runningTask) return;
    const category = CATEGORY_FOR_KIND[runningTask.kind] ?? "work";
    const t = setInterval(() => {
      setAccumulated((prev) => {
        const next = { ...prev, [category]: (prev[category] ?? 0) + 1 };
        saveAccumulated(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [focus.task, focus.isPaused, rawTasks]);

  // ── Auto-pause on lunch ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const h = currentTime.getHours() + currentTime.getMinutes() / 60;
    if (h >= lunchStart && h < lunchEnd && focus.task && !focus.isPaused) {
      pauseFocus();
      api.stopFocus("paused").catch(() => {});
    }
  }, [
    currentTime,
    lunchStart,
    lunchEnd,
    focus.task,
    focus.isPaused,
    pauseFocus,
  ]);

  // ── Lock states per task ────────────────────────────────────────────────────────────────────

  const lockedStates = useMemo(() => {
    const h = currentTime.getHours() + currentTime.getMinutes() / 60;
    const result: Record<string, "lunch" | "cutoff" | null> = {};
    rawTasks.forEach((t) => {
      result[t.id] = isTaskLocked(t, h, lunchStart, lunchEnd, cutoffHour);
    });
    return result;
  }, [currentTime, rawTasks, lunchStart, lunchEnd, cutoffHour]);

  // Keep node data in sync with lock states and focus
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          locked: lockedStates[n.id] ?? null,
          isFocused: focus.task === (n.data.task as Task).text,
          isPaused: focus.isPaused && focus.task === (n.data.task as Task).text,
        },
      })),
    );
  }, [lockedStates, focus.task, focus.isPaused, setNodes]);

  // ── Position persistence ───────────────────────────────────────────────────

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Drag always writes to the free positions key
      const hasDrag = changes.some(
        (c) => c.type === "position" && c.position && c.dragging,
      );
      if (hasDrag) {
        const posUpdate = { ...loadFreePositions() };
        changes.forEach((c) => {
          if (c.type === "position" && c.position) posUpdate[c.id] = c.position;
        });
        saveFreePositions(posUpdate);
      }
    },
    [onNodesChange],
  );

  // ── Edge creation ──────────────────────────────────────────────────────────

  const handleConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    setPendingConn({
      source: conn.source,
      target: conn.target,
      x: window.innerWidth / 2 - 110,
      y: window.innerHeight / 2 - 60,
    });
  }, []);

  const confirmEdge = useCallback(
    async (kind: "blocks" | "subtask") => {
      if (!pendingConn) return;
      const conn = pendingConn;
      setPendingConn(null);
      try {
        const edge = await api.createEdge(conn.source, conn.target, kind);
        setRawEdges((prev) => [...prev, edge]);
        setEdges((prev) => [...prev, toFlowEdge(edge)]);
        api.getReadyTasks().then((r) => setReadyIds(new Set(r.ready)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("409") || msg.includes("cycle")) {
          alert("Cannot link — this would create a circular dependency.");
        }
      }
    },
    [pendingConn, setEdges],
  );

  // ── Edge deletion ──────────────────────────────────────────────────────────

  const handleDeleteEdge = useCallback(
    async (id: string) => {
      try {
        await api.deleteEdge(id);
        setRawEdges((prev) => prev.filter((e) => e.id !== id));
        setEdges((prev) => prev.filter((e) => e.id !== id));
        api.getReadyTasks().then((r) => setReadyIds(new Set(r.ready)));
      } catch {
        /* ignore */
      }
    },
    [setEdges],
  );

  // ── Task creation ──────────────────────────────────────────────────────────

  const handleAddTask = useCallback(
    async (text: string, kind: "must" | "personal" | "small") => {
      try {
        const task = await api.createTask(kind, text);
        // Place it to the right of the existing free layout
        const existingPos = loadFreePositions();
        const maxX = Object.values(existingPos).reduce(
          (m, p) => Math.max(m, p.x),
          0,
        );
        const newPos = { x: maxX + NODE_W + 60, y: 0 };
        existingPos[task.id] = newPos;
        saveFreePositions(existingPos);

        const newNode: TaskNodeType = {
          id: task.id,
          type: "task",
          position: newPos,
          data: {
            task,
            estimate: undefined,
            isReady: true,
            isFocused: false,
            isPaused: false,
            locked: null,
          },
        };
        setNodes((prev) => [...prev, newNode]);
        setRawTasks((prev) => [...prev, task]);
        setReadyIds((prev) => new Set([...prev, task.id]));
        setGraph((prev) =>
          prev ? { ...prev, tasks: [...prev.tasks, task] } : prev,
        );
      } catch {
        /* ignore */
      }
    },
    [setNodes],
  );

  // ── Insert intermediate task on edge double-click ─────────────────────────

  const handleEdgeDoubleClick: EdgeMouseHandler<Edge> = useCallback(
    (event, edge) => {
      const edgeData = rawEdges.find((e) => e.id === edge.id);
      if (!edgeData) return;
      setInsertOnEdge({
        edgeId: edge.id,
        sourceId: edgeData.source_id,
        targetId: edgeData.target_id,
        kind: (edgeData.kind as "blocks" | "subtask") ?? "blocks",
        x: event.clientX,
        y: event.clientY,
      });
      setSelectedTaskId(null);
      setShowAddPanel(false);
    },
    [rawEdges],
  );

  const handleInsertOnEdge = useCallback(
    async (text: string, kind: "must" | "personal" | "small") => {
      if (!insertOnEdge) return;
      const { edgeId, sourceId, targetId, kind: edgeKind } = insertOnEdge;
      setInsertOnEdge(null);

      try {
        // 1. Create the new intermediate task
        const task = await api.createTask(kind, text);

        // 2. Position it between source and target nodes
        const existingPos = loadFreePositions();
        const srcPos = existingPos[sourceId] ?? { x: 0, y: 0 };
        const tgtPos = existingPos[targetId] ?? { x: NODE_W + 60, y: 0 };
        const midPos = {
          x: (srcPos.x + tgtPos.x) / 2,
          y: (srcPos.y + tgtPos.y) / 2 + NODE_H * 1.5,
        };
        existingPos[task.id] = midPos;
        saveFreePositions(existingPos);

        // 3. Delete the original edge
        await api.deleteEdge(edgeId);

        // 4. Create source → new and new → target edges
        const [e1, e2] = await Promise.all([
          api.createEdge(sourceId, task.id, edgeKind),
          api.createEdge(task.id, targetId, edgeKind),
        ]);

        // 5. Update local state atomically
        const newNode: TaskNodeType = {
          id: task.id,
          type: "task",
          position: midPos,
          data: {
            task,
            estimate: undefined,
            isReady: false,
            isFocused: false,
            isPaused: false,
            locked: null,
          },
        };

        setNodes((prev) => [...prev, newNode]);
        setRawTasks((prev) => [...prev, task]);
        setRawEdges((prev) => [...prev.filter((e) => e.id !== edgeId), e1, e2]);
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== edgeId),
          toFlowEdge(e1),
          toFlowEdge(e2),
        ]);
        setGraph((prev) =>
          prev ? { ...prev, tasks: [...prev.tasks, task] } : prev,
        );
        api.getReadyTasks().then((r) => setReadyIds(new Set(r.ready)));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("409") || msg.includes("cycle")) {
          alert("Cannot insert — this would create a circular dependency.");
        }
      }
    },
    [insertOnEdge, setNodes, setEdges],
  );

  // ── Focus handlers ────────────────────────────────────────────────────────────────────

  const handleStartFocus = useCallback(
    (taskId: string, durationSecs: number) => {
      const task = rawTasks.find((t) => t.id === taskId);
      if (!task) return;
      api.startFocus(taskId).catch(() => {});
      startFocus(task.text, durationSecs);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === taskId
            ? { ...n, data: { ...n.data, isFocused: true, isPaused: false } }
            : { ...n, data: { ...n.data, isFocused: false } },
        ),
      );
    },
    [rawTasks, startFocus, setNodes],
  );

  const handlePauseFocus = useCallback(() => {
    pauseFocus();
    api.stopFocus("paused").catch(() => {});
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isPaused: n.data.isFocused ? true : n.data.isPaused,
        },
      })),
    );
  }, [pauseFocus, setNodes]);

  const handleCompleteFocus = useCallback(
    async (taskId: string) => {
      try {
        await api.stopFocus("done");
        await api.toggleTask(taskId);
      } catch {}
      exitFocus("done");
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: {
            ...n.data,
            isFocused: false,
            isPaused: false,
            task:
              n.id === taskId
                ? { ...(n.data.task as Task), done: true }
                : n.data.task,
          },
        })),
      );
      setRawTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, done: true } : t)),
      );
      setSelectedTaskId(null);
      api.getReadyTasks().then((r) => setReadyIds(new Set(r.ready)));
    },
    [exitFocus, setNodes],
  );

  // ── Delete task ─────────────────────────────────────────────────────────────────

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      try {
        await api.deleteTask(taskId);
      } catch {
        /* ignore */
      }
      setNodes((prev) => prev.filter((n) => n.id !== taskId));
      setRawTasks((prev) => prev.filter((t) => t.id !== taskId));
      setRawEdges((prev) =>
        prev.filter((e) => e.source_id !== taskId && e.target_id !== taskId),
      );
      setEdges((prev) =>
        prev.filter((e) => e.source !== taskId && e.target !== taskId),
      );
      setGraph((prev) =>
        prev
          ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) }
          : prev,
      );
      setSelectedTaskId(null);
      api.getReadyTasks().then((r) => setReadyIds(new Set(r.ready)));
    },
    [setNodes, setEdges],
  );

  // ── Node click ────────────────────────────────────────────────────────────────────

  const handleNodeClick: NodeMouseHandler<TaskNodeType> = useCallback(
    (_e, node) => {
      setSelectedTaskId((prev) => (prev === node.id ? null : node.id));
      setShowAddPanel(false);
      setInsertOnEdge(null);
    },
    [],
  );

  // ── Auto-layout ────────────────────────────────────────────────────────────

  const handleAutoLayout = useCallback(
    (dir?: "LR") => {
      if (!graph) return;
      const direction = dir ?? "LR";
      // LR: compute dagre positions, apply to canvas — do NOT save to localStorage
      // This keeps free positions untouched
      const pos = dagreLayout(graph.tasks, rawEdges, direction);
      setNodes((prev) =>
        prev.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
      );
    },
    [graph, rawEdges, setNodes],
  );

  // When switching back to Free, restore saved free positions
  const handleRestoreFree = useCallback(() => {
    const saved = loadFreePositions();
    if (Object.keys(saved).length === 0) return; // nothing saved yet
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        position: saved[n.id] ?? n.position,
      })),
    );
  }, [setNodes]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSelectedTaskId(null);
      setPendingConn(null);
      setShowAddPanel(false);
      setInsertOnEdge(null);
    }
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedTask = selectedTaskId
    ? (rawTasks.find((t) => t.id === selectedTaskId) ?? null)
    : null;
  const doneCount = rawTasks.filter((t) => t.done).length;
  const blockedCount = rawTasks.filter(
    (t) => !t.done && !readyIds.has(t.id),
  ).length;
  const readyCount = rawTasks.filter(
    (t) => !t.done && readyIds.has(t.id),
  ).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading)
    return (
      <div className="map-shell">
        <div className="map-state">Loading map…</div>
      </div>
    );
  if (error)
    return (
      <div className="map-shell">
        <div className="map-state map-state--error">{error}</div>
      </div>
    );

  return (
    <div className="map-shell" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Toolbar */}
      <div className="map-toolbar">
        <div className="map-stats">
          <span className="map-stat">
            <span className="map-stat-dot map-stat-dot--ready" />
            {readyCount} ready
          </span>
          <span className="map-stat map-stat--sep" />
          <span className="map-stat">
            <span className="map-stat-dot map-stat-dot--blocked" />
            {blockedCount} blocked
          </span>
          <span className="map-stat map-stat--sep" />
          <span className="map-stat">
            <span className="map-stat-dot map-stat-dot--done" />
            {doneCount} done
          </span>
        </div>

        <div className="map-actions">
          <button
            className={`map-btn${showAddPanel ? " map-btn--active" : ""}`}
            onClick={() => {
              setShowAddPanel((v) => !v);
              setSelectedTaskId(null);
            }}
          >
            <IconAdd /> Add task
          </button>
          {/* Layout toggle: Free / Horizontal */}
          <div className="map-layout-toggle">
            <button
              className={`map-layout-btn${layoutDir === "free" ? " map-layout-btn--on" : ""}`}
              title="Free — drag nodes anywhere"
              onClick={() => {
                setLayoutDir("free");
                handleRestoreFree();
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <circle cx="3" cy="3" r="1.5" />
                <circle cx="13" cy="7" r="1.5" />
                <circle cx="6" cy="13" r="1.5" />
                <circle cx="11" cy="12" r="1.5" />
              </svg>
            </button>
            <button
              className={`map-layout-btn${layoutDir === "LR" ? " map-layout-btn--on" : ""}`}
              title="Horizontal tree (left → right)"
              onClick={() => {
                setLayoutDir("LR");
                handleAutoLayout("LR");
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="5" width="4" height="6" rx="1" />
                <rect x="10" y="2" width="4" height="4" rx="1" />
                <rect x="10" y="10" width="4" height="4" rx="1" />
                <path d="M5 8h3M8 4l2 4-2 4" strokeWidth="1.3" />
              </svg>
            </button>
          </div>
          <button
            className="map-btn map-btn--ghost"
            onClick={async () => {
              if (!confirm("Remove all dependency links?")) return;
              await Promise.all(rawEdges.map((e) => api.deleteEdge(e.id)));
              setRawEdges([]);
              setEdges([]);
            }}
            title="Clear all edges"
          >
            <IconClear />
          </button>
        </div>
      </div>

      {/* Canvas + side panels */}
      <div className="map-body">
        <div className="map-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onEdgeDoubleClick={handleEdgeDoubleClick}
            onPaneClick={() => {
              setSelectedTaskId(null);
              setShowAddPanel(false);
              setInsertOnEdge(null);
            }}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.24 }}
            minZoom={0.25}
            maxZoom={2}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="var(--color-stone)"
            />
            <Controls showInteractive={false} />
            <DayTimeline
              now={currentTime}
              workdayStart={blockConfig?.workday_start_hour ?? 9}
              workdayEnd={blockConfig?.workday_end_hour ?? 17}
              lunchStart={lunchStart}
              lunchEnd={lunchEnd}
              cutoffHour={cutoffHour}
            />
          </ReactFlow>
        </div>

        {/* Add task panel */}
        {showAddPanel && (
          <AddTaskPanel
            onAdd={handleAddTask}
            onClose={() => setShowAddPanel(false)}
          />
        )}

        {/* Right sidebar — always visible when no add panel */}
        {!showAddPanel &&
          (selectedTask ? (
            <TaskControlPanel
              task={selectedTask}
              edges={rawEdges}
              tasks={rawTasks}
              allTasks={rawTasks}
              focus={focus}
              accumulated={accumulated}
              blockConfig={blockConfig}
              locked={lockedStates[selectedTask.id] ?? null}
              onStartFocus={handleStartFocus}
              onPauseFocus={handlePauseFocus}
              onCompleteFocus={handleCompleteFocus}
              onDeleteEdge={handleDeleteEdge}
              onDeleteTask={handleDeleteTask}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onClose={() => setSelectedTaskId(null)}
            />
          ) : (
            <AmbientSidebar
              accumulated={accumulated}
              blockConfig={blockConfig}
              allTasks={rawTasks}
              now={currentTime}
              lunchStart={lunchStart}
              lunchEnd={lunchEnd}
              cutoffHour={cutoffHour}
            />
          ))}
      </div>

      {/* Insert intermediate task popover */}
      {insertOnEdge && (
        <InsertOnEdgePopover
          x={insertOnEdge.x}
          y={insertOnEdge.y}
          onInsert={handleInsertOnEdge}
          onCancel={() => setInsertOnEdge(null)}
        />
      )}

      {/* Edge kind popover */}
      {pendingConn && (
        <EdgePopover
          x={pendingConn.x}
          y={pendingConn.y}
          onPick={confirmEdge}
          onCancel={() => setPendingConn(null)}
        />
      )}
    </div>
  );
}
