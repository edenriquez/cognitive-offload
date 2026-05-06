import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import Ring from "../shared/Ring";
import type { Task } from "../../types";

type TaskKind = "must" | "personal" | "small";

export default function TodayMode() {
  const { tasks, setTasks, toggleTask, bandwidth, startFocus, now, signals } =
    useAppStore();
  const [revealBw, setRevealBw] = useState(false);
  const [revealCtx, setRevealCtx] = useState(false);
  const [loading, setLoading] = useState(!tasks.length);

  // New task input
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<TaskKind>("must");
  const createRef = useRef<HTMLInputElement>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  const hour = now.getHours() + now.getMinutes() / 60;
  const greet =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const nextTask = tasks.find(
    (t) => !t.done && (t.kind === "must" || t.kind === "personal"),
  );
  const total =
    bandwidth.work + bandwidth.personal + bandwidth.admin + bandwidth.learning;

  const activeThread = signals?.active_session;
  const warnIntervention = signals?.interventions.find(
    (i) => i.severity === "warn",
  );

  // Refresh tasks from API
  useEffect(() => {
    api
      .getToday()
      .then((data) => {
        if (data.tasks) setTasks(data.tasks);
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

  const handleFocus = (task: string) => {
    const t = tasks.find((t) => t.text === task);
    if (t) api.startFocus(t.id).catch(() => {});
    startFocus(task);
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

        <div className="today-greet">{greet} · day 14</div>
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
          <div className="ttasks">
            {tasks.map((t) => (
              <div
                key={t.id}
                className={`ttask ${t.done ? "done" : ""} ${t.id === nextTask?.id ? "active" : ""}`}
              >
                <span className={`ttask-rank ${t.kind}`}>
                  {t.kind === "must"
                    ? `Must ${t.idx}`
                    : t.kind === "personal"
                      ? "Personal"
                      : "Small"}
                </span>

                {editingId === t.id ? (
                  <input
                    ref={editRef}
                    className="ttask-edit-input"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={commitEdit}
                  />
                ) : (
                  <div
                    className="ttask-text"
                    onClick={() => !t.done && startEdit(t)}
                    style={{ cursor: t.done ? "default" : "text" }}
                  >
                    {t.text}
                  </div>
                )}

                <div className="ttask-actions">
                  {t.id === nextTask?.id && !t.done ? (
                    <button
                      className="ttask-go"
                      onClick={() => handleFocus(t.text)}
                    >
                      Focus
                    </button>
                  ) : (
                    <span
                      className="ttask-check"
                      onClick={() => handleToggle(t.id)}
                    ></span>
                  )}
                  <span
                    className="ttask-delete"
                    onClick={() => handleDelete(t.id)}
                    title="Delete"
                  >
                    ×
                  </span>
                </div>
              </div>
            ))}
          </div>
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
            Allocated · {total}% &nbsp;·&nbsp; Cutoff · 16:30 &nbsp;·&nbsp;
            Productive · 6h
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
            {tasks
              .filter((t) => t.kind === "must")
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
