import { useState, useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
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

// ── Constants ─────────────────────────────────────────────────────────────────

const GRID_COL = 260;
const GRID_ROW = 120;

// Typed node types map for React Flow
const nodeTypes = { task: TaskNode } as const;

// ── Layout helpers ────────────────────────────────────────────────────────────

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(
      localStorage.getItem("cogload_map_positions") ?? "{}",
    ) as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function savePositions(positions: Record<string, { x: number; y: number }>) {
  localStorage.setItem("cogload_map_positions", JSON.stringify(positions));
}

function autoLayoutPositions(
  tasks: Task[],
  edges: TaskEdge[],
): Record<string, { x: number; y: number }> {
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  tasks.forEach((t) => {
    inDegree[t.id] = 0;
    adj[t.id] = [];
  });
  edges.forEach((e) => {
    if (adj[e.source_id]) adj[e.source_id].push(e.target_id);
    inDegree[e.target_id] = (inDegree[e.target_id] ?? 0) + 1;
  });

  const layer: Record<string, number> = {};
  const queue = tasks
    .filter((t) => (inDegree[t.id] ?? 0) === 0)
    .map((t) => t.id);
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
      const totalW = ids.length * GRID_COL;
      const startX = -totalW / 2 + i * GRID_COL;
      pos[id] = { x: startX, y: l * GRID_ROW };
    });
  });
  return pos;
}

// Convert TaskEdge → React Flow Edge
function toFlowEdge(e: TaskEdge): Edge {
  return {
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: "smoothstep",
    animated: false,
    style: {
      stroke:
        e.kind === "blocks"
          ? "var(--color-carbon)"
          : "var(--color-lead)",
      strokeWidth: 1.5,
      strokeDasharray: e.kind === "subtask" ? "5 4" : undefined,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color:
        e.kind === "blocks"
          ? "var(--color-carbon)"
          : "var(--color-lead)",
    },
    data: { kind: e.kind },
  };
}

// ── Edge kind popover ─────────────────────────────────────────────────────────

interface EdgePopoverProps {
  x: number;
  y: number;
  onPick: (kind: "blocks" | "subtask") => void;
  onCancel: () => void;
}

function EdgePopover({ x, y, onPick, onCancel }: EdgePopoverProps) {
  return (
    <>
      <div className="map-popover-backdrop" onClick={onCancel} />
      <div className="map-popover" style={{ left: x, top: y }}>
        <div className="map-popover-label">Relationship type</div>
        <button className="map-popover-btn" onClick={() => onPick("blocks")}>
          <span className="map-popover-kind-dot map-popover-kind-dot--blocks" />
          Blocks
          <span className="map-popover-desc">A must be done before B</span>
        </button>
        <button className="map-popover-btn" onClick={() => onPick("subtask")}>
          <span className="map-popover-kind-dot map-popover-kind-dot--subtask" />
          Subtask of
          <span className="map-popover-desc">B is part of A</span>
        </button>
      </div>
    </>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  task: Task;
  edges: TaskEdge[];
  tasks: Task[];
  onDeleteEdge: (id: string) => void;
  onClose: () => void;
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
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

function DetailPanel({
  task,
  edges,
  tasks,
  onDeleteEdge,
  onClose,
}: DetailPanelProps) {
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

  return (
    <div className="map-detail">
      <div className="map-detail-header">
        <span className={`map-detail-kind map-detail-kind--${task.kind}`}>
          {task.kind}
        </span>
        <button className="map-detail-close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p
        className={`map-detail-text${task.done ? " map-detail-text--done" : ""}`}
      >
        {task.text}
      </p>

      {blockedBy.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">Blocked by</div>
          {blockedBy.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.source_id]?.text ?? e.source_id}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove dependency"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">Blocks</div>
          {blocking.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.target_id]?.text ?? e.target_id}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove dependency"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {subtasks.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">Subtasks</div>
          {subtasks.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.target_id]?.text ?? e.target_id}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove subtask link"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {parentOf.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section-label">Subtask of</div>
          {parentOf.map((e) => (
            <div key={e.id} className="map-detail-edge-row">
              <span className="map-detail-edge-text">
                {taskMap[e.source_id]?.text ?? e.source_id}
              </span>
              <button
                className="map-detail-edge-delete"
                onClick={() => onDeleteEdge(e.id)}
                title="Remove parent link"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {blockedBy.length === 0 &&
        blocking.length === 0 &&
        subtasks.length === 0 &&
        parentOf.length === 0 && (
          <div className="map-detail-empty">
            No dependencies. Drag from the → handle to connect.
          </div>
        )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MapMode() {
  const { focus } = useAppStore();
  const [graph, setGraph] = useState<TaskGraph | null>(null);
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // React Flow state — typed with our custom node type
  const [nodes, setNodes, onNodesChange] = useNodesState<TaskNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Raw graph data (for detail panel and edge creation)
  const [rawEdges, setRawEdges] = useState<TaskEdge[]>([]);
  const [rawTasks, setRawTasks] = useState<Task[]>([]);

  // UI state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingConn, setPendingConn] = useState<{
    source: string;
    target: string;
    x: number;
    y: number;
  } | null>(null);

  // ── Build React Flow nodes ─────────────────────────────────────────────

  const buildNodes = useCallback(
    (
      g: TaskGraph,
      readySet: Set<string>,
      pos: Record<string, { x: number; y: number }>,
      focusTask: string | null,
    ): TaskNodeType[] => {
      return g.tasks.map(
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
          } satisfies TaskNodeData,
        }),
      );
    },
    [],
  );

  // ── Load graph ─────────────────────────────────────────────────────────

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
        const hasSaved = g.tasks.some((t) => saved[t.id]);
        const pos = hasSaved
          ? saved
          : autoLayoutPositions(g.tasks, g.edges);

        setNodes(buildNodes(g, readySet, pos, focus.task));
        setEdges(g.edges.map(toFlowEdge));
      } catch {
        if (!cancelled) setError("Could not load task graph. Is the backend running?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save positions when nodes move ─────────────────────────────────────

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      const posUpdate: Record<string, { x: number; y: number }> = {
        ...loadPositions(),
      };
      changes.forEach((c) => {
        if (c.type === "position" && c.position) {
          posUpdate[c.id] = c.position;
        }
      });
      savePositions(posUpdate);
    },
    [onNodesChange],
  );

  // ── Edge connection ─────────────────────────────────────────────────────

  const handleConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    setPendingConn({
      source: conn.source,
      target: conn.target,
      x: window.innerWidth / 2 - 100,
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
          alert("Cannot create this dependency — it would create a cycle.");
        }
      }
    },
    [pendingConn, setEdges],
  );

  // ── Delete edge ─────────────────────────────────────────────────────────

  const handleDeleteEdge = useCallback(
    async (id: string) => {
      try {
        await api.deleteEdge(id);
        setRawEdges((prev) => prev.filter((e) => e.id !== id));
        setEdges((prev) => prev.filter((e) => e.id !== id));
        api.getReadyTasks().then((r) => setReadyIds(new Set(r.ready)));
      } catch {
        // ignore
      }
    },
    [setEdges],
  );

  // ── Node click → select for detail panel ───────────────────────────────

  const handleNodeClick: NodeMouseHandler<TaskNodeType> = useCallback(
    (_e, node) => {
      setSelectedTaskId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  // ── Auto layout ────────────────────────────────────────────────────────

  const handleAutoLayout = useCallback(() => {
    if (!graph) return;
    const pos = autoLayoutPositions(graph.tasks, rawEdges);
    savePositions(pos);
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        position: pos[n.id] ?? n.position,
      })),
    );
  }, [graph, rawEdges, setNodes]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTaskId(null);
        setPendingConn(null);
      }
    },
    [],
  );

  // ── Derived ────────────────────────────────────────────────────────────

  const selectedTask = selectedTaskId
    ? rawTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  const doneCount = rawTasks.filter((t) => t.done).length;
  const blockedCount = rawTasks.filter(
    (t) => !t.done && !readyIds.has(t.id),
  ).length;
  const readyCount = rawTasks.filter(
    (t) => !t.done && readyIds.has(t.id),
  ).length;

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="map-shell">
        <div className="map-loading">Loading map…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="map-shell">
        <div className="map-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="map-shell" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Toolbar */}
      <div className="map-toolbar">
        <div className="map-toolbar-stats">
          <span className="map-stat">
            <span className="map-stat-dot map-stat-dot--ready" />
            {readyCount} ready
          </span>
          <span className="map-stat">
            <span className="map-stat-dot map-stat-dot--blocked" />
            {blockedCount} blocked
          </span>
          <span className="map-stat">
            <span className="map-stat-dot map-stat-dot--done" />
            {doneCount} done
          </span>
        </div>
        <div className="map-toolbar-actions">
          <button className="map-btn" onClick={handleAutoLayout}>
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
              <path d="M8 2v12M3 7l5-5 5 5" />
            </svg>
            Auto-layout
          </button>
          <button
            className="map-btn map-btn--danger"
            onClick={async () => {
              if (!confirm("Remove all dependency edges?")) return;
              await Promise.all(rawEdges.map((e) => api.deleteEdge(e.id)));
              setRawEdges([]);
              setEdges([]);
            }}
          >
            Clear edges
          </button>
        </div>
      </div>

      {/* Canvas + Detail panel */}
      <div className="map-body">
        <div className="map-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={2}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="var(--color-stone)"
            />
            <Controls showInteractive={false} className="map-controls" />
            <MiniMap
              nodeStrokeWidth={2}
              nodeColor={(n) => {
                const d = n.data as TaskNodeData;
                if (d.task.done) return "var(--color-stone)";
                if (!d.isReady) return "#fbbf24";
                return "var(--color-action-blue)";
              }}
              className="map-minimap"
            />
          </ReactFlow>
        </div>

        {selectedTask && (
          <DetailPanel
            task={selectedTask}
            edges={rawEdges}
            tasks={rawTasks}
            onDeleteEdge={handleDeleteEdge}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

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
