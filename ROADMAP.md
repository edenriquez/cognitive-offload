# Cogload — Feature Roadmap

## Current State: What's Real vs Demo

| Component | Status | Detail |
|-----------|--------|--------|
| Tauri native shell | ✅ Real | macOS overlay titlebar, window dragging |
| 5 mode UIs | ✅ Real | Focus, Today, Capture, Review, Tomorrow |
| Go backend structure | ✅ Real | API, SQLite schema, enforcement engine |
| Enforcement engine | ⚠️ Partial | 11 rules defined, fed by DefaultSignals() |
| Signal strip | ⚠️ Hardcoded | Always shows thrashing/3/2.8×/4/16:30 |
| Review/Energy map | ❌ Hardcoded | Math.random() buckets, static patterns |
| Data collection | ❌ Missing | No file watcher, git, or LLM proxy |
| WebSocket signals | ❌ Missing | No WS client in frontend |

## Phase 0 — Wire the Pipes (1 week)
Every screen reads from the API, not hardcoded JSX.
- 0.1 Frontend WebSocket client → Zustand signals store
- 0.2 Today mode fetches tasks via GET /api/v1/today
- 0.3 Captures POST to backend, fetch on mount
- 0.4 Review fetches from GET /api/v1/review/:day
- 0.5 Tomorrow fetches from GET /api/v1/tomorrow
- 0.6 Focus POSTs start/stop to backend
- 0.7 Signal strip driven by WebSocket, not hardcoded
- 0.8 Gravity card reads active_thread from API
- 0.9 Ribbon shows/hides from live interventions
- 0.10 Seed realistic demo data on first boot

## Phase 1 — Data Collection (2 weeks)
Passively observe work, populate database with real events.
- 1.1 File system watcher (fsnotify)
- 1.2 Git monitor (commits, branches, diffs)
- 1.3 Idle detector
- 1.4 Event aggregator → 10-min buckets
- 1.5 LLM session proxy on :9201
- 1.6 Claude Code log parser
- 1.7 Terminal monitor (build/test/error)
- 1.8 Ingest coordinator

## Phase 2 — Real-Time Signals (1.5 weeks)
ComputeSignals() returns truth, not defaults.
- 2.1 Activity density scoring (0-100)
- 2.2 Error rate computation (rolling baseline)
- 2.3 Session lifecycle manager (stalled/orphan detection)
- 2.4 Thread count signals from session table
- 2.5 Cognitive threshold estimator
- 2.6 Stuck task detector
- 2.7 Post-lunch crash detector
- 2.8 Thrashing detector

## Phase 3 — Pattern Detection & Review (1.5 weeks)
Review mode shows real analysis.
- 3.1-3.8: Pattern persistence, leak calculator, root cause inference, daily summary, dynamic ReviewMode, real energy map, multi-day trends

## Phase 4 — Tomorrow Plan Generation (1 week)
Plan derived from today's audit.
- 4.1-4.7: Plan generator, constraint derivation, bandwidth adjustment, task pre-selection, lock/rollover, dynamic TomorrowMode, plan editing

## Phase 5 — Live Interventions (1 week, parallel after Phase 2)
Active interventions when problems detected.
- 5.1-5.8: WS push, dismissal tracking, override friction, dynamic gravity/ribbon/toast/blocker, cold-start gate

## Phase 6 — Task Management (1 week)
- 6.1-6.7: Create/edit/reorder/delete tasks, CRUD endpoints, real bandwidth tracking, capture→task promotion

## Phase 7 — Settings (1 week)
- 7.1-7.8: Settings mode, cutoff/cap/paths/proxy config, rule toggle, config.toml persistence

## Phase 8 — Polish (2 weeks)
- 8.1-8.10: Loading states, empty states, error handling, onboarding, icon, auto-update, native menu, tray, perf, tests

## Timeline
Total: ~12 weeks. MVP (Phases 0-2): ~4.5 weeks.

## This Week
1. 0.1 — WebSocket client in frontend
2. 0.2 — Today mode reads from API
3. 0.3 — Captures persist to backend
4. 0.10 — Seed realistic demo data
5. 1.1 — File system watcher
