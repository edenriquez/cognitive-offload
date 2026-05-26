import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../api/client";
import type { EmailWatch, EmailMatch } from "../../types";

// ── Icons ─────────────────────────────────────────────────────────────────────

export function IconEnvelope({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="3" width="14" height="10" rx="1.5" />
      <path d="M1 5l7 5 7-5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="13"
      height="13"
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

function IconTrash() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M5 4l.5 9h5l.5-9" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M5 3v10M11 3v10" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2l10 6-10 6V2z" />
    </svg>
  );
}

function IconClose() {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

export function timeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSec);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const INTERVAL_OPTIONS = [
  { label: "5 min", secs: 300 },
  { label: "10 min", secs: 600 },
  { label: "15 min", secs: 900 },
  { label: "30 min", secs: 1800 },
];

// ── Gmail setup instructions ──────────────────────────────────────────────────

function GmailInstructions({ onClose }: { onClose: () => void }) {
  return (
    <div className="ewm-instructions">
      <div className="ewm-instructions-header">
        <span className="ewm-instructions-title">Setting up Gmail</span>
        <button className="ewm-icon-btn" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <ol className="ewm-steps">
        <li>
          <strong>Enable IMAP in Gmail</strong>
          <p>
            Gmail Settings → See all settings → Forwarding and POP/IMAP → Enable
            IMAP → Save
          </p>
        </li>
        <li>
          <strong>Create an App Password</strong>
          <p>
            Google Account → Security → 2-Step Verification must be ON → App
            passwords → Select app: Mail → Generate
          </p>
          <p className="ewm-note">
            Use the 16-character code shown — not your regular password.
          </p>
        </li>
        <li>
          <strong>Enter credentials in Settings</strong>
          <p>
            Server: <code>imap.gmail.com:993</code> · TLS: on · Username: your
            Gmail address · Password: the app password
          </p>
        </li>
      </ol>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface EmailWatchModalProps {
  taskId: string;
  taskName: string;
  onClose: () => void;
  onWatchChange?: (watch: EmailWatch | null) => void;
}

export function EmailWatchModal({
  taskId,
  taskName,
  onClose,
  onWatchChange,
}: EmailWatchModalProps) {
  const [watches, setWatches] = useState<EmailWatch[]>([]);
  const [matches, setMatches] = useState<EmailMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Form state
  const [fromFilter, setFromFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [intervalSecs, setIntervalSecs] = useState(300);
  const [creating, setCreating] = useState(false);

  // Live ticker for "N ago" labels
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.listEmailWatches(taskId);
      setWatches(data.watches ?? []);
      setMatches(data.matches ?? []);
      if ((data.watches ?? []).length === 0) setShowForm(true);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!fromFilter.trim() && !subjectFilter.trim()) return;
    setCreating(true);
    try {
      const w = await api.createEmailWatch(
        taskId,
        fromFilter.trim(),
        subjectFilter.trim(),
        intervalSecs,
      );
      const next = [...watches, w];
      setWatches(next);
      setFromFilter("");
      setSubjectFilter("");
      setIntervalSecs(300);
      setShowForm(false);
      onWatchChange?.(w);
    } catch {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteEmailWatch(id);
      const next = watches.filter((w) => w.id !== id);
      setWatches(next);
      onWatchChange?.(next[0] ?? null);
      if (next.length === 0) setShowForm(true);
    } catch {
      /* ignore */
    }
  };

  const handlePause = async (id: string) => {
    try {
      const res = await api.pauseEmailWatch(id);
      setWatches((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, status: res.status as EmailWatch["status"] }
            : w,
        ),
      );
    } catch {
      /* ignore */
    }
  };

  const matchByWatch = Object.fromEntries(matches.map((m) => [m.watch_id, m]));
  const hasActiveWatch = watches.some(
    (w) => w.status === "active" || w.status === "paused",
  );

  return (
    <>
      {/* Backdrop */}
      <div className="ewm-backdrop" onClick={onClose} />

      {/* Modal */}
      <div className="ewm-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="ewm-header">
          <div className="ewm-header-left">
            <span className="ewm-header-icon">
              <IconEnvelope size={14} />
            </span>
            <div>
              <div className="ewm-title">Email watch</div>
              <div className="ewm-subtitle" title={taskName}>
                {taskName.length > 40 ? taskName.slice(0, 38) + "…" : taskName}
              </div>
            </div>
          </div>
          <div className="ewm-header-right">
            <button
              className="ewm-link-btn"
              onClick={() => setShowInstructions((v) => !v)}
              title="Gmail setup guide"
            >
              Gmail setup
            </button>
            <button className="ewm-icon-btn" onClick={onClose} title="Close">
              <IconClose />
            </button>
          </div>
        </div>

        {/* Gmail instructions (collapsible) */}
        {showInstructions && (
          <GmailInstructions onClose={() => setShowInstructions(false)} />
        )}

        {/* Loading */}
        {loading && <div className="ewm-loading">Loading…</div>}

        {!loading && (
          <div className="ewm-body">
            {/* Existing watches */}
            {watches.map((w) => {
              const match = matchByWatch[w.id];
              return (
                <div key={w.id} className={`ewm-watch ewm-watch--${w.status}`}>
                  {w.status === "matched" && match ? (
                    /* Matched */
                    <div className="ewm-matched-card">
                      <div className="ewm-matched-top">
                        <span className="ewm-matched-check">
                          <IconCheck />
                        </span>
                        <span className="ewm-matched-label">
                          Email arrived at {fmtTime(match.received_at)}
                        </span>
                      </div>
                      <div className="ewm-matched-subject">
                        {match.subject || "(no subject)"}
                      </div>
                      <div className="ewm-matched-from">{match.from_addr}</div>
                      <button
                        className="ewm-delete-watch"
                        onClick={() => handleDelete(w.id)}
                      >
                        Remove watch
                      </button>
                    </div>
                  ) : (
                    /* Active / paused */
                    <div className="ewm-watch-body">
                      <div className="ewm-watch-filters">
                        {w.from_filter && (
                          <div className="ewm-filter-row">
                            <span className="ewm-filter-key">From</span>
                            <span className="ewm-filter-val">
                              {w.from_filter}
                            </span>
                          </div>
                        )}
                        {w.subject_filter && (
                          <div className="ewm-filter-row">
                            <span className="ewm-filter-key">Subject</span>
                            <span className="ewm-filter-val">
                              {w.subject_filter}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="ewm-watch-meta-row">
                        <span className={`ewm-status ewm-status--${w.status}`}>
                          {w.status}
                        </span>
                        <span className="ewm-meta-sep">·</span>
                        <span className="ewm-meta">
                          every {Math.round(w.check_every_sec / 60)}m
                        </span>
                        {w.last_checked_at > 0 && (
                          <>
                            <span className="ewm-meta-sep">·</span>
                            <span className="ewm-meta">
                              checked {timeAgo(w.last_checked_at)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="ewm-watch-actions">
                        <button
                          className="ewm-action-btn"
                          onClick={() => handlePause(w.id)}
                        >
                          {w.status === "active" ? (
                            <>
                              <IconPause /> Pause
                            </>
                          ) : (
                            <>
                              <IconPlay /> Resume
                            </>
                          )}
                        </button>
                        <button
                          className="ewm-action-btn ewm-action-btn--danger"
                          onClick={() => handleDelete(w.id)}
                        >
                          <IconTrash /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add form */}
            {showForm && (
              <div className="ewm-form">
                {!hasActiveWatch && watches.length === 0 && (
                  <p className="ewm-form-intro">
                    Set up a watch to be notified when a specific email arrives
                    — no inbox tab needed.
                  </p>
                )}
                <div className="ewm-field">
                  <label className="ewm-field-label">
                    From <span className="ewm-field-hint">(partial match)</span>
                  </label>
                  <input
                    className="ewm-field-input"
                    placeholder="e.g. acme.com or billing@acme.com"
                    value={fromFilter}
                    onChange={(e) => setFromFilter(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") onClose();
                    }}
                  />
                </div>
                <div className="ewm-field">
                  <label className="ewm-field-label">
                    Subject{" "}
                    <span className="ewm-field-hint">(partial match)</span>
                  </label>
                  <input
                    className="ewm-field-input"
                    placeholder="e.g. invoice, contract, proposal"
                    value={subjectFilter}
                    onChange={(e) => setSubjectFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") onClose();
                    }}
                  />
                </div>
                <div className="ewm-field">
                  <label className="ewm-field-label">Check every</label>
                  <div className="ewm-intervals">
                    {INTERVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.secs}
                        className={`ewm-interval${intervalSecs === opt.secs ? " ewm-interval--on" : ""}`}
                        onClick={() => setIntervalSecs(opt.secs)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ewm-form-footer">
                  <button
                    className="ewm-submit"
                    onClick={handleCreate}
                    disabled={
                      creating || (!fromFilter.trim() && !subjectFilter.trim())
                    }
                  >
                    {creating ? "Setting up…" : "Start watching inbox"}
                  </button>
                  {watches.length > 0 && (
                    <button
                      className="ewm-cancel"
                      onClick={() => setShowForm(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Add another watch button */}
            {!showForm && watches.length > 0 && (
              <button
                className="ewm-add-another"
                onClick={() => setShowForm(true)}
              >
                + Add another watch
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Sidebar status row (compact, inside TaskControlPanel) ─────────────────────

interface EmailWatchStatusProps {
  taskId: string;
  onOpenModal: () => void;
}

export function EmailWatchStatus({
  taskId,
  onOpenModal,
}: EmailWatchStatusProps) {
  const [watches, setWatches] = useState<EmailWatch[]>([]);
  const [matches, setMatches] = useState<EmailMatch[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    api
      .listEmailWatches(taskId)
      .then((data) => {
        setWatches(data.watches ?? []);
        setMatches(data.matches ?? []);
      })
      .catch(() => {});
  }, [taskId]);

  // Refresh "N ago" every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const activeWatch = watches.find(
    (w) => w.status === "active" || w.status === "paused",
  );
  const matchedWatch = watches.find((w) => w.status === "matched");
  const match = matches.find((m) => m.watch_id === matchedWatch?.id);

  if (watches.length === 0) return null;

  return (
    <div
      className="ewp-status-row"
      onClick={onOpenModal}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenModal();
      }}
    >
      <span className="ewp-status-icon">
        <IconEnvelope size={12} />
      </span>
      {matchedWatch && match ? (
        <span className="ewp-status-text ewp-status-text--matched">
          Email arrived · {fmtTime(match.received_at)}
        </span>
      ) : activeWatch ? (
        <span className="ewp-status-text">
          Watching ·{" "}
          {activeWatch.last_checked_at > 0
            ? `checked ${timeAgo(activeWatch.last_checked_at)}`
            : "pending first check"}
        </span>
      ) : null}
      <span className="ewp-status-edit">Edit →</span>
    </div>
  );
}
