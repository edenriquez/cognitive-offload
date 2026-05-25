import { useState, useEffect, useCallback, useRef } from "react";
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

const GRID_COL = 280;
const GRID_ROW = 140;
const nodeTypes = { task: TaskNode } as const;

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(
      localStorage.getItem("cogload_map_positions") ?? "{}",
    ) as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function savePositions(pos: Record<string, { x: number; y: number }>) {
  localStorage.setItem("cogload_map_positions", JSON.stringify(pos));
}

function autoLayoutPositions(
  tasks: Task[],
  edges: TaskEdge[],
): Record<string, { x: number; y: number }> {
  const inDeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  tasks.forEach((t) => {
    inDeg[t.id] = 0;
    adj[t.id] = [];
  });
  edges.forEach((e) => {
    if (adj[e.source_id]) adj[e.source_id].push(e.target_id);
    inDeg[e.target_id] = (inDeg[e.target_id] ?? 0) + 1;
  });

  const layer: Record<string, number> = {};
  const queue = tasks.filter((t) => (inDeg[t.id] ?? 0) === 0).map((t) => t.id);
  queue.forEach((id) => (layer[id] = 0));
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    (adj[id] ?? []).forEach((child) => {
      const next = (layer[id] ?? 0) + 1;
      if (layer[child] === undefined || layer[child] < next) {
        layer[child] = next;
        queue.push(child);
      }
    });
  }

  const byLayer: Record<number, string[]> = {};
  tasks.forEach((t) => {
    const l = layer[t.id] ?? 0;
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(t.id);
  });

  const pos: Record<string, { x: number; y: number }> = {};
  Object.entries(byLayer).forEach(([lStr, ids]) => {
    const l = Number(lStr);
    ids.forEach((id, i) => {
      pos[id] = {
        x: i * GRID_COL - ((ids.length - 1) * GRID_COL) / 2,
        y: l * GRID_ROW,
      };
    });
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

// ── Edge kind popover ──────────────────────────────────────────────────────────

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

// ── Add Task panel ─────────────────────────────────────────────────────────────

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
  const { focus } = useAppStore();

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
  const [insertOnEdge, setInsertOnEdge] = useState<{
    edgeId: string;
    sourceId: string;
    targetId: string;
    kind: "blocks" | "subtask";
    x: number;
    y: number;
  } | null>(null);

  // ── Build nodes ────────────────────────────────────────────────────────────

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
            x: (i % 4) * GRID_COL,
            y: Math.floor(i / 4) * GRID_ROW,
          },
          data: {
            task,
            estimate: undefined,
            isReady: readySet.has(task.id),
            isFocused: focusTask === task.text,
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
        const saved = loadPositions();
        const pos = g.tasks.some((t) => saved[t.id])
          ? saved
          : autoLayoutPositions(g.tasks, g.edges);
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

  // ── Position persistence ───────────────────────────────────────────────────

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      const posUpdate = { ...loadPositions() };
      changes.forEach((c) => {
        if (c.type === "position" && c.position) posUpdate[c.id] = c.position;
      });
      savePositions(posUpdate);
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
        // Place it to the right of the existing layout
        const existingPos = loadPositions();
        const maxX = Object.values(existingPos).reduce(
          (m, p) => Math.max(m, p.x),
          0,
        );
        const newPos = { x: maxX + GRID_COL, y: 0 };
        existingPos[task.id] = newPos;
        savePositions(existingPos);

        const newNode: TaskNodeType = {
          id: task.id,
          type: "task",
          position: newPos,
          data: { task, estimate: undefined, isReady: true, isFocused: false },
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
        const existingPos = loadPositions();
        const srcPos = existingPos[sourceId] ?? { x: 0, y: 0 };
        const tgtPos = existingPos[targetId] ?? { x: GRID_COL, y: 0 };
        const midPos = {
          x: (srcPos.x + tgtPos.x) / 2,
          y: (srcPos.y + tgtPos.y) / 2 + GRID_ROW * 0.5,
        };
        existingPos[task.id] = midPos;
        savePositions(existingPos);

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
          data: { task, estimate: undefined, isReady: false, isFocused: false },
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

  // ── Node click ─────────────────────────────────────────────────────────────

  const handleNodeClick: NodeMouseHandler<TaskNodeType> = useCallback(
    (_e, node) => {
      setSelectedTaskId((prev) => (prev === node.id ? null : node.id));
      setShowAddPanel(false);
      setInsertOnEdge(null);
    },
    [],
  );

  // ── Auto-layout ────────────────────────────────────────────────────────────

  const handleAutoLayout = useCallback(() => {
    if (!graph) return;
    const pos = autoLayoutPositions(graph.tasks, rawEdges);
    savePositions(pos);
    setNodes((prev) =>
      prev.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
    );
  }, [graph, rawEdges, setNodes]);

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
          <button className="map-btn" onClick={handleAutoLayout}>
            <IconLayout /> Auto-layout
          </button>
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
          </ReactFlow>
        </div>

        {/* Add task panel */}
        {showAddPanel && (
          <AddTaskPanel
            onAdd={handleAddTask}
            onClose={() => setShowAddPanel(false)}
          />
        )}

        {/* Detail panel — shown when a node is selected */}
        {selectedTask && !showAddPanel && (
          <DetailPanel
            task={selectedTask}
            edges={rawEdges}
            tasks={rawTasks}
            onDeleteEdge={handleDeleteEdge}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
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
