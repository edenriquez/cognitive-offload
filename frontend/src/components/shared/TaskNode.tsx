import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Task, TaskEstimate } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskNodeData extends Record<string, unknown> {
  task: Task;
  estimate?: TaskEstimate;
  isReady: boolean;
  isFocused: boolean;
}

// v12: NodeProps takes a full Node<Data> type. Build the node type here.
import type { Node } from "@xyflow/react";
export type TaskNodeType = Node<TaskNodeData, "task">;

// ── Color maps ────────────────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  must: "var(--color-ink)",
  personal: "var(--color-action-blue)",
  small: "var(--color-lead)",
};

const COMPLEXITY_COLORS: Record<string, string> = {
  trivial: "var(--color-success-green)",
  low: "var(--color-success-green)",
  medium: "var(--color-warning-yellow)",
  high: "var(--color-danger-red)",
  extreme: "var(--color-danger-red)",
};

// ── Component ─────────────────────────────────────────────────────────────────

function TaskNode({ data, selected }: NodeProps<TaskNodeType>) {
  const { task, estimate, isReady, isFocused } = data;

  const isBlocked = !isReady && !task.done;
  const statusClass = task.done
    ? "tnode--done"
    : isFocused
      ? "tnode--focused"
      : isBlocked
        ? "tnode--blocked"
        : "tnode--ready";

  return (
    <div
      className={`tnode ${statusClass}${selected ? " tnode--selected" : ""}`}
    >
      {/* Target handle — left side */}
      <Handle
        type="target"
        position={Position.Left}
        className="tnode-handle tnode-handle--target"
      />

      {/* Kind indicator row */}
      <div className="tnode-kind">
        <span
          className="tnode-kind-dot"
          style={{
            backgroundColor:
              KIND_COLORS[task.kind] ?? "var(--color-lead)",
          }}
        />
        <span className="tnode-kind-label">{task.kind}</span>

        {isBlocked && (
          <span
            className="tnode-blocked-icon"
            title="Blocked by incomplete dependencies"
          >
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
              <rect x="3" y="7" width="10" height="8" rx="1.5" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" />
            </svg>
          </span>
        )}

        {isFocused && <span className="tnode-focus-dot" />}
      </div>

      {/* Task text */}
      <div className={`tnode-text${task.done ? " tnode-text--done" : ""}`}>
        {task.text}
      </div>

      {/* Cognitive load bar — only if estimate exists */}
      {estimate && (
        <div className="tnode-estimate">
          <div className="tnode-estimate-bar">
            <div
              className="tnode-estimate-fill"
              style={{
                width: `${estimate.cognitive_load}%`,
                backgroundColor:
                  COMPLEXITY_COLORS[estimate.complexity] ??
                  "var(--color-lead)",
              }}
            />
          </div>
          <span className="tnode-estimate-label">
            {estimate.estimated_min}m · {estimate.complexity}
          </span>
        </div>
      )}

      {/* Source handle — right side */}
      <Handle
        type="source"
        position={Position.Right}
        className="tnode-handle tnode-handle--source"
      />
    </div>
  );
}

export default memo(TaskNode);
