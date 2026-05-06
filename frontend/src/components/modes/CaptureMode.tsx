import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";

export default function CaptureMode() {
  const { captures, setCaptures, addCapture } = useAppStore();
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  // Fetch captures from backend on mount
  useEffect(() => {
    api
      .listCaptures()
      .then((caps) => setCaptures(caps))
      .catch(() => {});
  }, [setCaptures]);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 100);
  }, []);

  const submit = async () => {
    if (!draft.trim()) return;
    try {
      const cap = await api.createCapture(draft.trim());
      addCapture(cap);
    } catch {
      // Fallback: add locally
      addCapture({
        id: Math.random().toString(36).slice(2),
        text: draft.trim(),
        created_at: new Date().toISOString(),
      });
    }
    setDraft("");
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCapture(id);
      setCaptures(captures.filter((c) => c.id !== id));
    } catch {}
  };

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

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
          {captures.slice(0, 8).map((c, i) => (
            <div
              key={c.id}
              className={`capture-recent-row ${i === 0 ? "fresh" : ""}`}
            >
              {c.text}
              <span className="age">· {timeAgo(c.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
