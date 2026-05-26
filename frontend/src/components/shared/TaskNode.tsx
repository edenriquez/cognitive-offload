import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import type { Task, TaskEstimate } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TaskNodeData extends Record<string, unknown> {
  task: Task;
  estimate?: TaskEstimate;
  isReady: boolean;
  isFocused: boolean;
  isPaused: boolean;
  locked: "lunch" | "cutoff" | null;
}

export type TaskNodeType = Node<TaskNodeData, "task">;

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconLock() {
  return (
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
  );
}

function IconDone() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8l4 4 6-7" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M5 3v10M11 3v10" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

function TaskNode({ data, selected }: NodeProps<TaskNodeType>) {
  const { task, estimate, isReady, isFocused, isPaused, locked } = data;
  const isBlocked = !isReady && !task.done;

  const stateClass = task.done
    ? "tnode--done"
    : locked === "lunch"
      ? "tnode--locked-lunch"
      : locked === "cutoff"
        ? "tnode--locked-cutoff"
        : isPaused
          ? "tnode--paused"
          : isFocused
            ? "tnode--active"
            : isBlocked
              ? "tnode--blocked"
              : "tnode--idle";

  return (
    <div className={`tnode ${stateClass}${selected ? " tnode--selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="tnode-handle" />

      <div className="tnode-header">
        <span className="tnode-kind">{task.kind}</span>
        {task.done && (
          <span className="tnode-status-icon tnode-status-icon--done">
            <IconDone />
          </span>
        )}
        {(locked === "lunch" || locked === "cutoff") && !task.done && (
          <span className="tnode-status-icon tnode-status-icon--locked">
            <IconLock />
          </span>
        )}
        {isBlocked && !task.done && !locked && (
          <span className="tnode-status-icon tnode-status-icon--blocked">
            <IconLock />
          </span>
        )}
        {isPaused && !locked && !task.done && (
          <span className="tnode-status-icon tnode-status-icon--paused">
            <IconPause />
          </span>
        )}
        {isFocused && !isPaused && <span className="tnode-pulse" />}
      </div>

      <div className="tnode-text">{task.text}</div>

      {estimate && (
        <div className="tnode-load">
          <div className="tnode-load-track">
            <div
              className="tnode-load-fill"
              style={{ width: `${estimate.cognitive_load}%` }}
            />
          </div>
          <span className="tnode-load-label">{estimate.estimated_min}m</span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="tnode-handle"
      />
    </div>
  );
}

export default memo(TaskNode);
