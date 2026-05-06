import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";

export default function CaptureMode() {
  const { captures, setCaptures, addCapture, setTasks, tasks } = useAppStore();
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .listCaptures()
      .then((caps) => {
        if (Array.isArray(caps)) setCaptures(caps);
      })
      .catch(() => {});
  }, [setCaptures]);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 100);
  }, []);

  const submit = async () => {
    if (!draft.trim()) return;
    try {
      const cap = await api.createCapture(draft.trim());
      if (cap?.id) addCapture(cap);
    } catch {
      addCapture({
        id: Math.random().toString(36).slice(2),
        text: draft.trim(),
        created_at: new Date().toISOString(),
      });
    }
    setDraft("");
  };

  const handleDelete = async (id: string) => {
    if (!id) return;
    setCaptures((captures ?? []).filter((c) => c.id !== id));
    try {
      await api.deleteCapture(id);
    } catch {}
  };

  const handlePromote = async (id: string) => {
    if (!id) return;
    try {
      const task = await api.promoteCapture(id);
      if (task?.id) {
        setCaptures((captures ?? []).filter((c) => c.id !== id));
        setTasks([...(tasks ?? []), task]);
      }
    } catch {}
  };

  const timeAgo = (iso: string): string => {
    if (!iso) return "";
    try {
      const diff = Date.now() - new Date(iso).getTime();
      if (isNaN(diff)) return "";
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    } catch {
      return "";
    }
  };

  const safeCaptures = Array.isArray(captures) ? captures : [];

  return (
    <div className="capture">
      <div className="capture-inner">
        <div className="capture-eye">Capture · no thinking required</div>
        <input
          ref={ref}
          className="capture-input"
          placeholder="what's on your mind…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <div className="capture-hint">
          <kbd>↵</kbd> to capture &nbsp; <kbd>esc</kbd> to leave
        </div>
        <div className="capture-recent">
          {safeCaptures.slice(0, 10).map((c, i) => (
            <div
              key={c?.id ?? i}
              className={`capture-recent-row ${i === 0 ? "fresh" : ""}`}
            >
              <div className="capture-row">
                <span className="capture-row-text">{c?.text ?? ""}</span>
                <span className="age">· {timeAgo(c?.created_at)}</span>
                <div className="capture-row-actions">
                  <button
                    className="capture-action-btn promote"
                    onClick={() => handlePromote(c.id)}
                    title="Promote to task"
                  >
                    ↑ task
                  </button>
                  <button
                    className="capture-action-btn delete"
                    onClick={() => handleDelete(c.id)}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
