import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";
import type { BlockConfig } from "../../types";

// ---------------------------------------------------------------------------
// Engine rules — all 11 from engine.go
// ---------------------------------------------------------------------------
const ENGINE_RULES: { id: string; label: string }[] = [
  { id: "COLD_START.NO_PLAN", label: "Cold start: no plan" },
  { id: "COLD_START.ENV", label: "Cold start: environment broken" },
  { id: "LOAD.PERF_DEGRADATION", label: "Performance degradation" },
  { id: "THREAD.ORPHANS", label: "Orphan threads" },
  { id: "LOAD.FATIGUE", label: "Fatigue detection" },
  { id: "LOAD.STUCK", label: "Stuck task" },
  { id: "LOAD.BLACK_HOLE", label: "Inactivity detection" },
  { id: "ENERGY.POST_LUNCH", label: "Post-lunch crash" },
  { id: "CUTOFF.PAST", label: "Past cutoff" },
  { id: "LOOPS.OVERFLOW", label: "Open loops overflow" },
  { id: "REPLAN.OVERWORK", label: "Overwork replan" },
];

// ---------------------------------------------------------------------------
// Time helpers — build 30-min increments from 14:00 to 22:00
// ---------------------------------------------------------------------------
function timeOptions(startHour: number, endHour: number) {
  const opts: { value: number; label: string }[] = [];
  for (let h = startHour; h <= endHour; h += 0.5) {
    const hh = Math.floor(h);
    const mm = h % 1 === 0.5 ? "30" : "00";
    const ampm = hh >= 12 ? "PM" : "AM";
    const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
    opts.push({ value: h, label: `${display}:${mm} ${ampm}` });
  }
  return opts;
}

const CUTOFF_OPTIONS = timeOptions(14, 22);
const LUNCH_OPTIONS = timeOptions(11, 15);
const WORKDAY_START_OPTIONS = timeOptions(5, 12);
const WORKDAY_END_OPTIONS = timeOptions(14, 22);
const BREAK_START_OPTIONS = timeOptions(5, 22);
const BREAK_END_OPTIONS = timeOptions(5, 22);

function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = h % 1 === 0.5 ? "30" : "00";
  const ampm = hh >= 12 ? "PM" : "AM";
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
  return `${display}:${mm} ${ampm}`;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------
interface Config {
  cutoff_hour: number;
  lunch_start: number;
  lunch_end: number;
  watch_paths: string[];
  ignore_dirs: string[];
  max_watch_dirs: number;
  disabled_rules: string[];
}

const DEFAULT_CONFIG: Config = {
  cutoff_hour: 16.5,
  lunch_start: 12,
  lunch_end: 13,
  watch_paths: [],
  ignore_dirs: [],
  max_watch_dirs: 50,
  disabled_rules: [],
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Email Settings sub-component
// ---------------------------------------------------------------------------
function EmailSettings() {
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        if (cfg.email) {
          setServer(cfg.email.imap_server ?? "");
          setUsername(cfg.email.username ?? "");
          setPassword(cfg.email.password ?? "");
          setTls(cfg.email.tls ?? true);
        }
      })
      .catch(() => {
        /* ignore — fields stay blank */
      });
  }, []);

  const handleTest = async () => {
    if (!server.trim() || !username.trim() || !password.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testEmailConnection(
        server.trim(),
        username.trim(),
        password.trim(),
        tls,
      );
      setTestResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("502") ||
        msg.includes("503");
      setTestResult({
        ok: false,
        error: isNetworkError
          ? "Cannot reach the Cogload backend. Make sure it is running (go run ./cmd/cogload)."
          : msg,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!server.trim() || !username.trim() || !password.trim()) return;
    // Save email config via updateConfig
    await api.updateConfig({
      email: {
        imap_server: server.trim(),
        username: username.trim(),
        password: password.trim(),
        tls,
      },
    } as any);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">Email Watch</div>
      <p
        className="settings-desc"
        style={{
          margin: "0 0 14px",
          fontSize: 12,
          color: "var(--color-overcast)",
        }}
      >
        IMAP credentials for inbox polling. Use an app-specific password, not
        your account password. Gmail: Settings → See all settings → Forwarding
        and POP/IMAP → Enable IMAP.
      </p>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">IMAP server</span>
          <span className="settings-desc">e.g. imap.gmail.com:993</span>
        </div>
        <input
          className="settings-input"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="imap.gmail.com:993"
        />
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Username</span>
          <span className="settings-desc">Your email address</span>
        </div>
        <input
          className="settings-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="you@gmail.com"
          autoComplete="off"
        />
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">App password</span>
          <span className="settings-desc">Not your account password</span>
        </div>
        <input
          className="settings-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="xxxx xxxx xxxx xxxx"
          autoComplete="new-password"
        />
      </div>

      <div className="settings-row">
        <div className="settings-label-group">
          <span className="settings-label">Use TLS</span>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={tls}
            onChange={(e) => setTls(e.target.checked)}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      <div className="settings-row" style={{ gap: 8 }}>
        <button
          className="settings-add-btn"
          onClick={handleTest}
          disabled={
            testing || !server.trim() || !username.trim() || !password.trim()
          }
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          className="settings-add-btn"
          onClick={handleSave}
          disabled={!server.trim() || !username.trim() || !password.trim()}
        >
          Save
        </button>
      </div>

      {testResult && (
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: "var(--radius-tags)",
            background: testResult.ok ? "rgba(7,90,57,0.08)" : "#fef2f2",
            color: testResult.ok
              ? "var(--color-success-green)"
              : "var(--color-danger-red)",
            marginTop: 8,
          }}
        >
          {testResult.ok
            ? "Connected successfully"
            : (testResult.error ?? "Connection failed")}
        </div>
      )}
    </div>
  );
}

// Component
// ---------------------------------------------------------------------------
export default function SettingsMode() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newIgnore, setNewIgnore] = useState("");
  const [blockConfig, setBlockConfig] = useState<BlockConfig | null>(null);
  const [newBreakLabel, setNewBreakLabel] = useState("");
  const [newBreakStart, setNewBreakStart] = useState(12.0);
  const [newBreakEnd, setNewBreakEnd] = useState(13.0);
  const [newBreakDays, setNewBreakDays] = useState<number[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch config on mount
  useEffect(() => {
    api
      .getConfig()
      .then((data) => {
        setConfig({
          cutoff_hour: data.cutoff_hour ?? DEFAULT_CONFIG.cutoff_hour,
          lunch_start: data.lunch_start ?? DEFAULT_CONFIG.lunch_start,
          lunch_end: data.lunch_end ?? DEFAULT_CONFIG.lunch_end,
          watch_paths: data.watch_paths ?? DEFAULT_CONFIG.watch_paths,
          ignore_dirs: data.ignore_dirs ?? DEFAULT_CONFIG.ignore_dirs,
          max_watch_dirs: data.max_watch_dirs ?? DEFAULT_CONFIG.max_watch_dirs,
          disabled_rules: data.disabled_rules ?? DEFAULT_CONFIG.disabled_rules,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    api
      .getBlockConfig()
      .then(setBlockConfig)
      .catch(() => {});
  }, []);

  // Flash the "Saved" indicator
  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  // Persist config — debounced
  const persistDebounced = useCallback(
    (updates: Partial<Config>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        api
          .updateConfig(updates as Record<string, unknown>)
          .then(() => flashSaved())
          .catch(() => {});
      }, 500);
    },
    [flashSaved],
  );

  // Persist config — immediate (for toggles)
  const persistImmediate = useCallback(
    (updates: Partial<Config>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      api
        .updateConfig(updates as Record<string, unknown>)
        .then(() => flashSaved())
        .catch(() => {});
    },
    [flashSaved],
  );

  // Updater helpers
  const updateField = useCallback(
    <K extends keyof Config>(key: K, value: Config[K], immediate = false) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      const updates = { [key]: value };
      if (immediate) {
        persistImmediate(updates);
      } else {
        persistDebounced(updates);
      }
    },
    [persistDebounced, persistImmediate],
  );

  const toggleRule = useCallback(
    (ruleId: string) => {
      setConfig((prev) => {
        const disabled = prev.disabled_rules.includes(ruleId)
          ? prev.disabled_rules.filter((r) => r !== ruleId)
          : [...prev.disabled_rules, ruleId];
        persistImmediate({ disabled_rules: disabled });
        return { ...prev, disabled_rules: disabled };
      });
    },
    [persistImmediate],
  );

  const addWatchPath = useCallback(() => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    setConfig((prev) => {
      if (prev.watch_paths.includes(trimmed)) return prev;
      const updated = [...prev.watch_paths, trimmed];
      persistImmediate({ watch_paths: updated });
      return { ...prev, watch_paths: updated };
    });
    setNewPath("");
  }, [newPath, persistImmediate]);

  const removeWatchPath = useCallback(
    (path: string) => {
      setConfig((prev) => {
        const updated = prev.watch_paths.filter((p) => p !== path);
        persistImmediate({ watch_paths: updated });
        return { ...prev, watch_paths: updated };
      });
    },
    [persistImmediate],
  );

  const addIgnoreDir = useCallback(() => {
    const trimmed = newIgnore.trim();
    if (!trimmed) return;
    setConfig((prev) => {
      if (prev.ignore_dirs.includes(trimmed)) return prev;
      const updated = [...prev.ignore_dirs, trimmed];
      persistImmediate({ ignore_dirs: updated });
      return { ...prev, ignore_dirs: updated };
    });
    setNewIgnore("");
  }, [newIgnore, persistImmediate]);

  // ---- Block Config persistence ----
  const saveBlockConfig = useCallback(
    (cfg: BlockConfig | null) => {
      if (!cfg) return;
      api
        .updateBlockConfig(cfg)
        .then(() => flashSaved())
        .catch(() => {});
    },
    [flashSaved],
  );

  const updateBlockField = useCallback(
    <K extends keyof BlockConfig>(key: K, value: BlockConfig[K]) => {
      setBlockConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [key]: value };
        saveBlockConfig(next);
        return next;
      });
    },
    [saveBlockConfig],
  );

  const updateAllocation = useCallback(
    (idx: number, pct: number) => {
      setBlockConfig((prev) => {
        if (!prev) return prev;
        const allocs = [...prev.allocations];
        // distribute the delta to the other allocation
        const old = allocs[idx].pct;
        const delta = pct - old;
        allocs[idx] = { ...allocs[idx], pct };
        // find the other non-zero allocation to adjust
        const otherIdx = idx === 0 ? 1 : 0;
        if (allocs[otherIdx]) {
          allocs[otherIdx] = {
            ...allocs[otherIdx],
            pct: Math.max(0, Math.min(100, allocs[otherIdx].pct - delta)),
          };
        }
        const next = { ...prev, allocations: allocs };
        saveBlockConfig(next);
        return next;
      });
    },
    [saveBlockConfig],
  );

  const addNonNegotiable = useCallback(() => {
    const trimmed = newBreakLabel.trim();
    if (!trimmed) return;
    setBlockConfig((prev) => {
      if (!prev) return prev;
      const entry = {
        id: `brk_${Date.now()}`,
        label: trimmed,
        start_hour: newBreakStart,
        end_hour: newBreakEnd,
        days: newBreakDays.length > 0 ? newBreakDays : [],
      };
      const next = {
        ...prev,
        non_negotiables: [...prev.non_negotiables, entry],
      };
      saveBlockConfig(next);
      return next;
    });
    setNewBreakLabel("");
    setNewBreakStart(12.0);
    setNewBreakEnd(13.0);
    setNewBreakDays([]);
  }, [
    newBreakLabel,
    newBreakStart,
    newBreakEnd,
    newBreakDays,
    saveBlockConfig,
  ]);

  const removeNonNegotiable = useCallback(
    (id: string) => {
      setBlockConfig((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          non_negotiables: prev.non_negotiables.filter((n) => n.id !== id),
        };
        saveBlockConfig(next);
        return next;
      });
    },
    [saveBlockConfig],
  );

  const removeIgnoreDir = useCallback(
    (dir: string) => {
      setConfig((prev) => {
        const updated = prev.ignore_dirs.filter((d) => d !== dir);
        persistImmediate({ ignore_dirs: updated });
        return { ...prev, ignore_dirs: updated };
      });
    },
    [persistImmediate],
  );

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="settings">
        <div className="settings-inner">
          <h1 className="settings-h">Settings</h1>
          <div className="settings-sub">Loading configuration…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="settings-header-row">
          <div>
            <h1 className="settings-h">Settings</h1>
            <div className="settings-sub">
              Configure thresholds, paths, and engine rules
            </div>
          </div>
          <span className={`settings-saved ${saved ? "on" : ""}`}>✓ Saved</span>
        </div>

        {/* ---- Block Budget ---- */}
        {blockConfig && (
          <div className="settings-section">
            <div className="settings-section-title">Block Budget</div>
            <span className="settings-section-desc">
              Configure how your workday is divided into focused time blocks
            </span>

            <div className="settings-row">
              <div className="settings-label-group">
                <span className="settings-label">Block duration</span>
                <span className="settings-desc">
                  Length of each focus block in minutes
                </span>
              </div>
              <input
                type="number"
                className="settings-input"
                min={15}
                max={180}
                step={15}
                value={blockConfig.block_duration_min}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 15 && v <= 180) {
                    updateBlockField("block_duration_min", v);
                  }
                }}
              />
            </div>

            <div className="settings-row">
              <div className="settings-label-group">
                <span className="settings-label">Workday start</span>
                <span className="settings-desc">When your workday begins</span>
              </div>
              <select
                className="settings-select"
                value={blockConfig.workday_start_hour}
                onChange={(e) =>
                  updateBlockField(
                    "workday_start_hour",
                    parseFloat(e.target.value),
                  )
                }
              >
                {WORKDAY_START_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-label-group">
                <span className="settings-label">Workday end</span>
                <span className="settings-desc">When your workday ends</span>
              </div>
              <select
                className="settings-select"
                value={blockConfig.workday_end_hour}
                onChange={(e) =>
                  updateBlockField(
                    "workday_end_hour",
                    parseFloat(e.target.value),
                  )
                }
              >
                {WORKDAY_END_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Allocation sliders */}
            {blockConfig.allocations.length >= 2 && (
              <div
                className="settings-row"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: "0.5rem",
                }}
              >
                <div className="settings-label-group">
                  <span className="settings-label">Time allocation</span>
                  <span className="settings-desc">
                    How to split blocks between categories
                  </span>
                </div>
                {blockConfig.allocations.map((alloc, idx) => (
                  <div
                    key={alloc.category}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.25rem 0",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: alloc.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ minWidth: 90, fontSize: "0.85rem" }}>
                      {alloc.label}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={alloc.pct}
                      onChange={(e) =>
                        updateAllocation(idx, parseInt(e.target.value, 10))
                      }
                      style={{ flex: 1 }}
                    />
                    <span
                      style={{
                        minWidth: 36,
                        textAlign: "right",
                        fontSize: "0.85rem",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {alloc.pct}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Non-negotiable breaks */}
            <div style={{ marginTop: "0.75rem" }}>
              <div
                className="settings-label-group"
                style={{ marginBottom: "0.5rem" }}
              >
                <span className="settings-label">Non-negotiable breaks</span>
                <span className="settings-desc">
                  Fixed time blocks that won't be scheduled over
                </span>
              </div>

              <div className="settings-list">
                {blockConfig.non_negotiables.map((brk) => (
                  <div key={brk.id} className="settings-list-item">
                    <span className="settings-list-path">
                      {brk.label} — {formatHour(brk.start_hour)}–
                      {formatHour(brk.end_hour)}
                      {brk.days.length > 0 &&
                        ` (${brk.days.map((d) => DAY_LABELS[d]).join(", ")})`}
                    </span>
                    <button
                      className="settings-list-remove"
                      onClick={() => removeNonNegotiable(brk.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {blockConfig.non_negotiables.length === 0 && (
                  <div className="settings-list-empty">
                    No breaks configured
                  </div>
                )}
              </div>

              <div
                className="settings-add-row"
                style={{ flexWrap: "wrap", gap: "0.5rem" }}
              >
                <input
                  type="text"
                  className="settings-add-input"
                  placeholder="Break label (e.g. Lunch)"
                  value={newBreakLabel}
                  onChange={(e) => setNewBreakLabel(e.target.value)}
                  style={{ minWidth: 140 }}
                />
                <select
                  className="settings-select"
                  value={newBreakStart}
                  onChange={(e) => setNewBreakStart(parseFloat(e.target.value))}
                >
                  {BREAK_START_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span
                  style={{ fontSize: "0.85rem", color: "var(--c-text-dim)" }}
                >
                  to
                </span>
                <select
                  className="settings-select"
                  value={newBreakEnd}
                  onChange={(e) => setNewBreakEnd(parseFloat(e.target.value))}
                >
                  {BREAK_END_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    display: "flex",
                    gap: "0.25rem",
                    alignItems: "center",
                  }}
                >
                  {DAY_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      className={`settings-add-btn${newBreakDays.includes(idx) ? "" : ""}`}
                      style={{
                        padding: "0.15rem 0.35rem",
                        fontSize: "0.7rem",
                        opacity: newBreakDays.includes(idx) ? 1 : 0.4,
                        minWidth: 0,
                      }}
                      onClick={() =>
                        setNewBreakDays((prev) =>
                          prev.includes(idx)
                            ? prev.filter((d) => d !== idx)
                            : [...prev, idx],
                        )
                      }
                      title={`${newBreakDays.includes(idx) ? "Remove" : "Add"} ${label}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button className="settings-add-btn" onClick={addNonNegotiable}>
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Time & Thresholds ---- */}
        <div className="settings-section">
          <div className="settings-section-title">Time &amp; Thresholds</div>

          <div className="settings-row">
            <div className="settings-label-group">
              <span className="settings-label">Cutoff hour</span>
              <span className="settings-desc">
                Stop-work time — triggers alerts when past
              </span>
            </div>
            <select
              className="settings-select"
              value={config.cutoff_hour}
              onChange={(e) =>
                updateField("cutoff_hour", parseFloat(e.target.value))
              }
            >
              {CUTOFF_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-label-group">
              <span className="settings-label">Lunch start</span>
              <span className="settings-desc">
                Beginning of your lunch window
              </span>
            </div>
            <select
              className="settings-select"
              value={config.lunch_start}
              onChange={(e) =>
                updateField("lunch_start", parseFloat(e.target.value))
              }
            >
              {LUNCH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-label-group">
              <span className="settings-label">Lunch end</span>
              <span className="settings-desc">End of your lunch window</span>
            </div>
            <select
              className="settings-select"
              value={config.lunch_end}
              onChange={(e) =>
                updateField("lunch_end", parseFloat(e.target.value))
              }
            >
              {LUNCH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-label-group">
              <span className="settings-label">Max watch dirs</span>
              <span className="settings-desc">
                Maximum number of directories to watch for file changes
              </span>
            </div>
            <input
              type="number"
              className="settings-input"
              min={1}
              max={500}
              value={config.max_watch_dirs}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= 500) {
                  updateField("max_watch_dirs", v);
                }
              }}
            />
          </div>
        </div>

        {/* ---- Watch Paths ---- */}
        <div className="settings-section">
          <div className="settings-section-title">Watch Paths</div>
          <span className="settings-section-desc">
            Directories to monitor for file-save events
          </span>

          <div className="settings-list">
            {config.watch_paths.map((p) => (
              <div key={p} className="settings-list-item">
                <span className="settings-list-path">{p}</span>
                <button
                  className="settings-list-remove"
                  onClick={() => removeWatchPath(p)}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {config.watch_paths.length === 0 && (
              <div className="settings-list-empty">
                No watch paths configured
              </div>
            )}
          </div>
          <div className="settings-add-row">
            <input
              type="text"
              className="settings-add-input"
              placeholder="/path/to/project"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addWatchPath();
              }}
            />
            <button className="settings-add-btn" onClick={addWatchPath}>
              Add
            </button>
          </div>
        </div>

        {/* ---- Ignore Dirs ---- */}
        <div className="settings-section">
          <div className="settings-section-title">Ignore Directories</div>
          <span className="settings-section-desc">
            Directory names to exclude from file watching
          </span>

          <div className="settings-list">
            {config.ignore_dirs.map((d) => (
              <div key={d} className="settings-list-item">
                <span className="settings-list-path">{d}</span>
                <button
                  className="settings-list-remove"
                  onClick={() => removeIgnoreDir(d)}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {config.ignore_dirs.length === 0 && (
              <div className="settings-list-empty">
                No ignore directories configured
              </div>
            )}
          </div>
          <div className="settings-add-row">
            <input
              type="text"
              className="settings-add-input"
              placeholder="node_modules"
              value={newIgnore}
              onChange={(e) => setNewIgnore(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addIgnoreDir();
              }}
            />
            <button className="settings-add-btn" onClick={addIgnoreDir}>
              Add
            </button>
          </div>
        </div>

        {/* ---- Engine Rules ---- */}
        <div className="settings-section">
          <div className="settings-section-title">Engine Rules</div>
          <span className="settings-section-desc">
            Toggle individual detection rules on or off
          </span>

          <div className="settings-rules">
            {ENGINE_RULES.map((rule) => {
              const enabled = !config.disabled_rules.includes(rule.id);
              return (
                <div key={rule.id} className="settings-rule-row">
                  <div className="settings-rule-info">
                    <span className="settings-rule-label">{rule.label}</span>
                    <span className="settings-rule-id">{rule.id}</span>
                  </div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleRule(rule.id)}
                    />
                    <span className="settings-toggle-track">
                      <span className="settings-toggle-thumb" />
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Email Watch ---- */}
        <EmailSettings />

        {/* ---- About ---- */}
        <div className="settings-section">
          <div className="settings-section-title">About</div>
          <div className="settings-row">
            <div className="settings-label-group">
              <span className="settings-label">Onboarding</span>
              <span className="settings-desc">
                Re-run the welcome wizard to reconfigure initial settings
              </span>
            </div>
            <button
              className="settings-add-btn"
              onClick={() => {
                localStorage.removeItem("cogload_onboarded");
                window.location.reload();
              }}
            >
              Re-run
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
