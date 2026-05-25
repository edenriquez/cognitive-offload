import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import type { Session } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs * 1000 : new Date(isoOrMs).getTime();
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function sessionAge(isoOrMs: string | number): number {
  const ms = typeof isoOrMs === "number" ? isoOrMs * 1000 : new Date(isoOrMs).getTime();
  return Math.floor((Date.now() - ms) / 60000); // minutes
}

function statusLabel(s: Session): { text: string; cls: string } {
  if (s.status === "closed") return { text: "closed", cls: "thr-tag--closed" };
  if (s.message_count <= 1) return { text: "orphan", cls: "thr-tag--orphan" };
  if (s.status === "stalled") return { text: "stalled", cls: "thr-tag--stalled" };
  const age = sessionAge(s.started_at as unknown as number);
  if (age > 90) return { text: "stalled", cls: "thr-tag--stalled" };
  return { text: "open", cls: "thr-tag--open" };
}

// SVG icons
function IconClose({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function IconCloseAll({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l3 3 7-7" />
      <path d="M9 4h5v5" />
    </svg>
  );
}

function IconThread({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M5.5 4.5L10.5 7M5.5 11.5L10.5 9" />
    </svg>
  );
}

function IconRefresh({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      <path d="M11 1v4h-4" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ThreadsMode() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "orphan" | "closed">("open");

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleClose = useCallback(async (id: string) => {
    setClosingId(id);
    try {
      await api.closeSession(id);
      setSessions((prev) =>
        prev.map((s) => s.id === id ? { ...s, status: "closed" } : s)
      );
    } catch { /* ignore */ } finally {
      setClosingId(null);
    }
  }, []);

  const handleCloseAll = useCallback(async () => {
    setClosingAll(true);
    const open = sessions.filter((s) => s.status !== "closed");
    try {
      await Promise.all(open.map((s) => api.closeSession(s.id)));
      setSessions((prev) => prev.map((s) => ({ ...s, status: "closed" })));
    } catch { /* ignore */ } finally {
      setClosingAll(false);
    }
  }, [sessions]);

  const startEdit = (s: Session) => {
    setEditingId(s.id);
    setEditLabel(s.label || "");
  };

  const commitEdit = useCallback(async (id: string) => {
    const label = editLabel.trim();
    setEditingId(null);
    if (!label) return;
    try {
      await api.updateSession(id, label, "open");
      setSessions((prev) =>
        prev.map((s) => s.id === id ? { ...s, label } : s)
      );
    } catch { /* ignore */ }
  }, [editLabel]);

  // ── Derived ────────────────────────────────────────────────────────────

  const openCount = sessions.filter((s) => s.status !== "closed").length;
  const orphanCount = sessions.filter(
    (s) => s.status !== "closed" && s.message_count <= 1
  ).length;

  const displayed = sessions.filter((s) => {
    if (filter === "open") return s.status !== "closed";
    if (filter === "orphan") return s.status !== "closed" && s.message_count <= 1;
    if (filter === "closed") return s.status === "closed";
    return true;
  });

  // Sort: orphans first, then by age (newest last so oldest issues bubble up)
  const sorted = [...displayed].sort((a, b) => {
    const aOrphan = a.message_count <= 1 ? 0 : 1;
    const bOrphan = b.message_count <= 1 ? 0 : 1;
    if (aOrphan !== bOrphan) return aOrphan - bOrphan;
    return (a.started_at as unknown as number) - (b.started_at as unknown as number);
  });

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="thr">
        <div className="thr-loading">Loading threads…</div>
      </div>
    );
  }

  return (
    <div className="thr">

      {/* Header */}
      <div className="thr-header">
        <div className="thr-header-top">
          <div className="thr-title-row">
            <span className="thr-icon"><IconThread size={16} /></span>
            <h2 className="thr-title">Thread triage</h2>
          </div>
          {openCount > 0 && (
            <button
              className="thr-btn-close-all"
              onClick={handleCloseAll}
              disabled={closingAll}
            >
              <IconCloseAll size={13} />
              {closingAll ? "Closing…" : `Close all ${openCount}`}
            </button>
          )}
        </div>

        {/* Summary sentence */}
        <p className="thr-summary">
          {openCount === 0
            ? "All threads resolved. Nothing left open."
            : orphanCount > 0
              ? `${openCount} open thread${openCount !== 1 ? "s" : ""} — ${orphanCount} never continued after the first message.`
              : `${openCount} open thread${openCount !== 1 ? "s" : ""} still unresolved.`
          }
        </p>

        {/* Filter tabs */}
        <div className="thr-filters">
          {(["open", "orphan", "closed", "all"] as const).map((f) => {
            const counts: Record<string, number> = {
              open: openCount,
              orphan: orphanCount,
              closed: sessions.filter((s) => s.status === "closed").length,
              all: sessions.length,
            };
            return (
              <button
                key={f}
                className={`thr-filter ${filter === f ? "on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
                <span className="thr-filter-count">{counts[f]}</span>
              </button>
            );
          })}
          <button
            className="thr-btn-refresh"
            onClick={fetchSessions}
            title="Refresh"
          >
            <IconRefresh size={13} />
          </button>
        </div>
      </div>

      {/* Session list */}
      {sorted.length === 0 ? (
        <div className="thr-empty">
          {filter === "open"
            ? "No open threads."
            : filter === "orphan"
              ? "No orphaned threads."
              : filter === "closed"
                ? "No closed threads yet."
                : "No threads found."
          }
        </div>
      ) : (
        <div className="thr-list">
          {sorted.map((s) => {
            const { text: tagText, cls: tagCls } = statusLabel(s);
            const isOrphan = s.message_count <= 1 && s.status !== "closed";
            const isClosed = s.status === "closed";
            const age = sessionAge(s.started_at as unknown as number);
            const isEditing = editingId === s.id;

            return (
              <div
                key={s.id}
                className={`thr-row${isClosed ? " thr-row--closed" : ""}${isOrphan ? " thr-row--orphan" : ""}`}
              >
                {/* Status indicator */}
                <div className={`thr-status-dot ${tagCls}`} />

                {/* Main content */}
                <div className="thr-row-body">
                  <div className="thr-row-top">
                    {isEditing ? (
                      <input
                        className="thr-label-input"
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onBlur={() => commitEdit(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(s.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <span
                        className="thr-label"
                        onClick={() => !isClosed && startEdit(s)}
                        title={isClosed ? undefined : "Click to rename"}
                      >
                        {s.label || <span className="thr-label-empty">Untitled thread</span>}
                      </span>
                    )}
                    <span className={`thr-tag ${tagCls}`}>{tagText}</span>
                  </div>

                  <div className="thr-row-meta">
                    <span className="thr-meta-item">
                      {s.message_count} msg{s.message_count !== 1 ? "s" : ""}
                    </span>
                    <span className="thr-meta-sep">·</span>
                    <span className="thr-meta-item">
                      {timeAgo(s.started_at as unknown as number)}
                    </span>
                    {age > 60 && !isClosed && (
                      <>
                        <span className="thr-meta-sep">·</span>
                        <span className="thr-meta-item thr-meta-warn">
                          {age}m old
                        </span>
                      </>
                    )}
                  </div>

                  {/* Orphan explanation */}
                  {isOrphan && (
                    <div className="thr-orphan-note">
                      Started but never continued — close it or add context.
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isClosed && (
                  <div className="thr-row-actions">
                    <button
                      className="thr-btn-close"
                      onClick={() => handleClose(s.id)}
                      disabled={closingId === s.id}
                      title="Mark as resolved"
                    >
                      <IconClose size={12} />
                      {closingId === s.id ? "…" : "Resolve"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
