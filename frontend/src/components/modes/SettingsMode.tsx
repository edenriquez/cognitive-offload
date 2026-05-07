import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client";

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
// Component
// ---------------------------------------------------------------------------
export default function SettingsMode() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newIgnore, setNewIgnore] = useState("");

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
