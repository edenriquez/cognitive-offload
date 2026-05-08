import { useState, useRef, useEffect, useCallback } from "react";
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
} from "@dnd-kit/sortable";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import Ring from "../shared/Ring";
import { SortableTaskItem } from "../shared/SortableTaskItem";
import type { Task } from "../../types";

type TaskKind = "must" | "personal" | "small";

export default function TodayMode() {
  const {
    tasks,
    setTasks,
    toggleTask,
    bandwidth,
    startFocus,
    resumeFocus,
    focus,
    now,
    signals,
  } = useAppStore();
  const [revealBw, setRevealBw] = useState(false);
  const [revealCtx, setRevealCtx] = useState(false);
  const [loading, setLoading] = useState(!tasks.length);
  const [completed, setCompleted] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // New task input
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<TaskKind>("must");
  const createRef = useRef<HTMLInputElement>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const hour = now.getHours() + now.getMinutes() / 60;
  const greet =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const nextTask = tasks.find(
    (t) => !t.done && (t.kind === "must" || t.kind === "personal"),
  );
  const total =
    bandwidth.work + bandwidth.personal + bandwidth.admin + bandwidth.learning;
  const dayNumber =
    Math.floor((Date.now() - new Date("2025-04-23").getTime()) / 86400000) + 1;

  const activeThread = signals?.active_session ?? null;
  const interventions = signals?.interventions ?? [];
  const warnIntervention =
    interventions.find((i) => i.severity === "warn") ?? null;

  // Refresh tasks from API
  useEffect(() => {
    api
      .getToday()
      .then((data) => {
        if (data.tasks) setTasks(data.tasks);
        if (data.completed !== undefined) setCompleted(data.completed);
        if (data.total !== undefined) setTotalCount(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setTasks]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const handleToggle = async (id: string) => {
    toggleTask(id);
    try {
      await api.toggleTask(id);
    } catch {
      toggleTask(id);
    }
  };

  const handleFocus = (taskText: string) => {
    if (!taskText) return;
    const t = tasks.find((t) => t.text === taskText);
    if (t) {
      try {
        api.startFocus(t.id).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    startFocus(taskText);
  };

  const handleCreate = async () => {
    if (!newText.trim()) return;
    try {
      const task = await api.createTask(newKind, newText.trim());
      setTasks([...tasks, task]);
      setNewText("");
    } catch {}
  };

  const handleDelete = async (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id));
    try {
      await api.deleteTask(id);
    } catch {
      // Refresh on failure
      api
        .getToday()
        .then((d) => {
          if (d.tasks) setTasks(d.tasks);
        })
        .catch(() => {});
    }
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditText(task.text);
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = tasks.findIndex((t) => t.id === active.id);
      const newIndex = tasks.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Optimistic reorder
      const reordered = arrayMove(tasks, oldIndex, newIndex).map((t, i) => ({
        ...t,
        idx: i + 1,
      }));
      setTasks(reordered);

      // Persist to backend
      try {
        await api.reorderTasks(
          reordered.map((t, i) => ({ id: t.id, idx: i + 1 })),
        );
      } catch {
        // Rollback on failure
        api
          .getToday()
          .then((d) => {
            if (d.tasks) setTasks(d.tasks);
          })
          .catch(() => {});
      }
    },
    [tasks, setTasks],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const activeDragTask = activeDragId
    ? (tasks.find((t) => t.id === activeDragId) ?? null)
    : null;

  const commitEdit = async () => {
    if (!editingId) return;
    const task = tasks.find((t) => t.id === editingId);
    if (!task || editText.trim() === task.text) {
      setEditingId(null);
      return;
    }
    // Optimistic
    setTasks(
      tasks.map((t) =>
        t.id === editingId ? { ...t, text: editText.trim() } : t,
      ),
    );
    setEditingId(null);
    try {
      await api.updateTask(editingId, editText.trim(), task.kind, task.idx);
    } catch {
      api
        .getToday()
        .then((d) => {
          if (d.tasks) setTasks(d.tasks);
        })
        .catch(() => {});
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="today">
        <div className="today-inner">
          <div className="today-greet">{greet}</div>
          <div className="today-q">
            <em>loading...</em>
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="ttask-skeleton">
              <div className="skel skel-sm"></div>
              <div className="skel skel-lg"></div>
              <div className="skel skel-xs"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="today">
      <div className="today-inner">
        {/* Thread gravity card */}
        {activeThread && (
          <div className="gravity">
            <div>
              <div className="gravity-eye">
                Active thread · {activeThread.duration_min}m open
              </div>
              <div className="gravity-task">{activeThread.label}</div>
              <div className="gravity-meta">
                last touch {activeThread.last_touch_ago_sec}s ago
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={() => handleFocus(activeThread.label)}
            >
              Resume →
            </button>
          </div>
        )}

        {/* Intervention ribbon */}
        {warnIntervention && (
          <div className="ribbon danger">
            <span className="pulse-dot"></span>
            <span>
              <b>{warnIntervention.title}.</b> {warnIntervention.body}
            </span>
            {activeThread && (
              <span
                className="ribbon-redirect"
                onClick={() => handleFocus(activeThread.label)}
              >
                Continue current thread →
              </span>
            )}
          </div>
        )}

        {/* Paused focus session banner */}
        {focus.isPaused && focus.task && focus.remainingSecs > 0 && (
          <div className="gravity">
            <div>
              <div className="gravity-eye">
                Paused · {Math.floor(focus.remainingSecs / 60)}m{" "}
                {focus.remainingSecs % 60}s remaining
              </div>
              <div className="gravity-task">{focus.task}</div>
            </div>
            <button className="btn-primary" onClick={resumeFocus}>
              Resume →
            </button>
          </div>
        )}

        <div className="today-greet">
          {greet} · day {dayNumber}
        </div>
        <div className="today-progress">
          <span className="today-progress-label">
            {completed}/{totalCount} tasks
          </span>
          <div className="today-progress-bar">
            <div
              className="today-progress-fill"
              style={{
                width: `${totalCount > 0 ? (completed / totalCount) * 100 : 0}%`,
              }}
            />
          </div>
          {signals?.wall_detected && (
            <span className="today-wall-badge">⚡ wall detected</span>
          )}
        </div>
        <div className="today-q">
          The one thing right now is{" "}
          <em>
            {nextTask ? nextTask.text.toLowerCase() : "rest. you're done."}
          </em>
        </div>

        {/* Task list */}
        {tasks.length === 0 ? (
          <div className="ttask-empty">
            <div className="ttask-empty-title">Plan your day</div>
            <div>Add your first task below to get started.</div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={tasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="ttasks">
                {tasks.map((t) => (
                  <SortableTaskItem
                    key={t.id}
                    task={t}
                    isNext={t.id === nextTask?.id}
                    isEditing={editingId === t.id}
                    editText={editText}
                    editRef={editRef}
                    onEditTextChange={setEditText}
                    onEditKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onEditBlur={commitEdit}
                    onStartEdit={startEdit}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onFocus={handleFocus}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragTask ? (
                <div
                  className="ttask ttask-drag-overlay"
                  style={{ gridTemplateColumns: "24px 90px 1fr auto" }}
                >
                  <span className="ttask-drag-handle">⠿</span>
                  <span className={`ttask-rank ${activeDragTask.kind}`}>
                    {activeDragTask.kind === "must"
                      ? `Must ${activeDragTask.idx}`
                      : activeDragTask.kind === "personal"
                        ? "Personal"
                        : "Small"}
                  </span>
                  <div className="ttask-text">{activeDragTask.text}</div>
                  <div className="ttask-actions" />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {/* Inline task creation */}
        <div className="ttask-create">
          <div className="kind-pills">
            {(["must", "personal", "small"] as TaskKind[]).map((k) => (
              <span
                key={k}
                className={`kind-pill ${newKind === k ? "on" : ""} ${k}`}
                onClick={() => setNewKind(k)}
              >
                {k}
              </span>
            ))}
          </div>
          <input
            ref={createRef}
            className="ttask-create-input"
            placeholder="Add a task…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>

        {/* Reveal pills */}
        <div className="reveal-row">
          <button
            className={`reveal-pill ${revealBw ? "on" : ""}`}
            onClick={() => setRevealBw((b) => !b)}
          >
            {revealBw ? "Hide bandwidth" : "Show bandwidth"}
          </button>
          <button
            className={`reveal-pill ${revealCtx ? "on" : ""}`}
            onClick={() => setRevealCtx((b) => !b)}
          >
            {revealCtx ? "Hide context" : "Show context"}
          </button>
        </div>

        <div className={`reveal-content ${revealBw ? "on" : ""}`}>
          <div className="ring-row">
            <Ring alloc={bandwidth} />
            <div className="ring-legend">
              <span>
                <i style={{ background: "#1c1d1f" }}></i>Work core
              </span>
              <b>{bandwidth.work}%</b>
              <span>
                <i style={{ background: "#407ff2" }}></i>Personal
              </span>
              <b>{bandwidth.personal}%</b>
              <span>
                <i style={{ background: "#8f99a8" }}></i>Admin
              </span>
              <b>{bandwidth.admin}%</b>
              <span>
                <i style={{ background: "#d3d8df" }}></i>Learning
              </span>
              <b>{bandwidth.learning}%</b>
            </div>
          </div>
          <div className="ctx-line">
            Allocated · {total}% &nbsp;·&nbsp; Cutoff ·{" "}
            {signals
              ? `${Math.floor(signals.cutoff_hour)}:${String(Math.round((signals.cutoff_hour % 1) * 60)).padStart(2, "0")}`
              : "—"}{" "}
            &nbsp;·&nbsp; Velocity ·{" "}
            {signals?.momentum_velocity
              ? `${Math.round(signals.momentum_velocity)} ev/h`
              : "—"}
          </div>
        </div>

        <div className={`reveal-content ${revealCtx ? "on" : ""}`}>
          <div
            className="ctx-line"
            style={{
              textAlign: "left",
              padding: "0 8px",
              lineHeight: 1.7,
              fontSize: 13,
            }}
          >
            {(tasks ?? [])
              .filter((t) => t?.kind === "must")
              .map((t, i) => (
                <span key={t.id}>
                  Must {i + 1} → {t.text}
                  <br />
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
