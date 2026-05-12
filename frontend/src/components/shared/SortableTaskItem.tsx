import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../../types";

export interface SortableTaskItemProps {
  task: Task;
  isNext: boolean;
  isEditing: boolean;
  editText: string;
  editRef: React.RefObject<HTMLInputElement | null>;
  onEditTextChange: (text: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onEditBlur: () => void;
  onStartEdit: (task: Task) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onFocus: (text: string) => void;
  onEstimate?: (task: Task) => void;
}

export function SortableTaskItem({
  task,
  isNext,
  isEditing,
  editText,
  editRef,
  onEditTextChange,
  onEditKeyDown,
  onEditBlur,
  onStartEdit,
  onToggle,
  onDelete,
  onFocus,
  onEstimate,
}: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    gridTemplateColumns: "24px 90px 1fr auto",
  };

  const rankLabel =
    task.kind === "must"
      ? `Must ${task.idx}`
      : task.kind === "personal"
        ? "Personal"
        : "Small";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`ttask ${task.done ? "done" : ""} ${isNext ? "active" : ""} ${isDragging ? "ttask-dragging" : ""}`}
    >
      {/* Drag handle – hidden when task is done */}
      {!task.done ? (
        <span className="ttask-drag-handle" {...attributes} {...listeners}>
          ⠿
        </span>
      ) : (
        <span />
      )}

      <span className={`ttask-rank ${task.kind}`}>{rankLabel}</span>

      {isEditing ? (
        <input
          ref={editRef as React.RefObject<HTMLInputElement>}
          className="ttask-edit-input"
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
        />
      ) : (
        <div
          className="ttask-text"
          onClick={() => !task.done && onStartEdit(task)}
          style={{ cursor: task.done ? "default" : "text" }}
        >
          {task.text}
        </div>
      )}

      <div className="ttask-actions">
        {!task.done && onEstimate && (
          <button
            className="ttask-estimate"
            onClick={() => onEstimate(task)}
            title="Estimate cognitive budget"
          >
            ⏱
          </button>
        )}
        {isNext && !task.done ? (
          <button className="ttask-go" onClick={() => onFocus(task.text)}>
            Focus
          </button>
        ) : (
          <span className="ttask-check" onClick={() => onToggle(task.id)} />
        )}
        <span
          className="ttask-delete"
          onClick={() => onDelete(task.id)}
          title="Delete"
        >
          ×
        </span>
      </div>
    </div>
  );
}
