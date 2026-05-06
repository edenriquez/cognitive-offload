# Cogload — Feature Roadmap

> Last updated: 2025-05-06  
> Strategy: **bottom-up** — CRUD first, then wire frontend, then collect real data.

## Current State

| Layer | What exists | What's missing |
|-------|-------------|----------------|
| **SQLite schema** | 7 tables (events, sessions, buckets, patterns, tasks, captures, plans) | No migrations versioning |
| **Store (Go)** | Read/write for all 7 tables | No task CREATE/UPDATE/DELETE, no capture DELETE, no focus_sessions table |
| **API (Go)** | 14 endpoints mounted on chi router | Missing full task CRUD, missing focus session persistence, leaks/rootcauses are hardcoded in handler |
| **Engine (Go)** | 11 enforcement rules, `ComputeSignals()` | Signals use `DefaultSignals()` fallback, no real data flow |
| **WebSocket (Go)** | Hub + broadcast + client handler | Works, but frontend never connects to it |
| **Frontend** | 5 modes render, Zustand store, CSS system | All data is hardcoded in JSX or fallback defaults |
| **Data collection** | Empty `ingest/` and `proxy/` packages | Nothing collects real events yet |

---

## Phase 1 — Complete the CRUD (1 week)

> Goal: Every entity has full create/read/update/delete in the backend. The database is the source of truth.

### 1A · Tasks — full lifecycle

| # | What | Where | Status |
|---|------|-------|--------|
| 1A.1 | `POST /api/v1/tasks` — create a task (kind, text, idx) | `router.go`, `store.go` | Missing |
| 1A.2 | `PUT /api/v1/tasks/:id` — update text, kind, idx | `router.go`, `store.go` | Missing |
| 1A.3 | `DELETE /api/v1/tasks/:id` — delete or archive | `router.go`, `store.go` | Missing |
| 1A.4 | `PATCH /api/v1/tasks/:id` — toggle done | `router.go` | ✅ Exists |
| 1A.5 | `GET /api/v1/today` — list tasks for today | `router.go` | ✅ Exists (seeds demo if empty) |
| 1A.6 | `POST /api/v1/tasks/reorder` — bulk update idx | `router.go`, `store.go` | Missing |

### 1B · Captures — persist and manage

| # | What | Where | Status |
|---|------|-------|--------|
| 1B.1 | `POST /api/v1/captures` — create | `router.go` | ✅ Exists |
| 1B.2 | `GET /api/v1/captures` — list recent | `router.go` | ✅ Exists |
| 1B.3 | `DELETE /api/v1/captures/:id` — remove | `router.go`, `store.go` | Missing |
| 1B.4 | `POST /api/v1/captures/:id/promote` — promote to task | `router.go`, `store.go` | Missing |

### 1C · Focus sessions — track in database

| # | What | Where | Status |
|---|------|-------|--------|
| 1C.1 | `focus_sessions` table — id, task_id, started_at, ended_at, duration_sec, outcome | `store.go` schema | Missing |
| 1C.2 | `POST /api/v1/focus/start` — insert row, return session id | `router.go` | Exists but doesn't persist |
| 1C.3 | `POST /api/v1/focus/stop` — update ended_at, compute duration | `router.go` | Exists but doesn't persist |
| 1C.4 | `GET /api/v1/focus/current` — return active focus session | `router.go`, `store.go` | Missing |
| 1C.5 | `GET /api/v1/focus/history` — list past focus sessions for a day | `router.go`, `store.go` | Missing |

### 1D · Sessions (LLM threads) — complete CRUD

| # | What | Where | Status |
|---|------|-------|--------|
| 1D.1 | `GET /api/v1/sessions` — list by day | `router.go` | ✅ Exists |
| 1D.2 | `POST /api/v1/sessions/:id/close` — close/archive | `router.go` | ✅ Exists |
| 1D.3 | `POST /api/v1/sessions` — manually create session | `router.go`, `store.go` | Missing |
| 1D.4 | `PUT /api/v1/sessions/:id` — update label/status | `router.go`, `store.go` | Missing |

### 1E · Plans — complete CRUD

| # | What | Where | Status |
|---|------|-------|--------|
| 1E.1 | `GET /api/v1/tomorrow` — get plan | `router.go` | ✅ Exists |
| 1E.2 | `POST /api/v1/tomorrow/lock` — lock plan | `router.go` | ✅ Exists |
| 1E.3 | `PUT /api/v1/tomorrow` — edit plan before locking | `router.go` | Missing |
| 1E.4 | `POST /api/v1/tomorrow/generate` — trigger plan generation | `router.go` | Missing |

**Exit criteria:** `curl` every endpoint, all return proper JSON. Create a task, toggle it, delete it, all persisted in SQLite.

---

## Phase 2 — Wire Frontend to Backend (1 week)

> Goal: Frontend talks to the API for everything. Zero hardcoded data in components.

### 2A · API client layer

| # | What | Where |
|---|------|-------|
| 2A.1 | Create `src/api/client.ts` — typed fetch wrapper for all endpoints | New file |
| 2A.2 | Error handling — retry on 5xx, surface errors to UI | `client.ts` |
| 2A.3 | Base URL config — use Vite proxy in dev, direct in Tauri production | `vite.config.ts`, `client.ts` |

### 2B · Wire each mode

| # | What | Where |
|---|------|-------|
| 2B.1 | **TodayMode** — fetch tasks on mount, toggle via API, remove hardcoded `setTasks` fallback | `App.tsx`, `TodayMode.tsx` |
| 2B.2 | **TodayMode** — gravity card reads `active_thread` from `/api/v1/today` response | `TodayMode.tsx` |
| 2B.3 | **TodayMode** — ribbon reads `interventions` from signals, show/hide dynamically | `TodayMode.tsx` |
| 2B.4 | **TodayMode** — add task creation input, call `POST /api/v1/tasks` | `TodayMode.tsx` |
| 2B.5 | **CaptureMode** — POST on enter, fetch recent on mount, delete on swipe | `CaptureMode.tsx` |
| 2B.6 | **FocusMode** — POST start on entry, POST stop on exit, persist duration | `FocusMode.tsx` |
| 2B.7 | **ReviewMode** — fetch from `/api/v1/review/:day`, replace all hardcoded stats/patterns/leaks | `ReviewMode.tsx` |
| 2B.8 | **ReviewMode** — EnergyMap receives real buckets from API, drop `Math.random()` | `EnergyMap.tsx` |
| 2B.9 | **TomorrowMode** — fetch plan from `/api/v1/tomorrow`, render constraints/tasks dynamically | `TomorrowMode.tsx` |
| 2B.10 | **TomorrowMode** — edit tasks/bandwidth before locking, call PUT then POST lock | `TomorrowMode.tsx` |

### 2C · WebSocket + signal strip

| # | What | Where |
|---|------|-------|
| 2C.1 | WebSocket client — connect to `/ws/signals`, reconnect on disconnect | `src/store/ws-client.ts` (new) |
| 2C.2 | Push signal snapshots into Zustand `signals` state | `ws-client.ts`, `app-store.ts` |
| 2C.3 | Signal strip reads from `signals` store, remove hardcoded fallback | `App.tsx` |
| 2C.4 | Toast driven by new interventions from WS, not static setTimeout | `App.tsx` |

**Exit criteria:** Kill the backend → frontend shows loading/empty states. Start backend → everything populates from API. Change data via curl → frontend updates.

---

## Phase 3 — Task Management UX (1 week)

> Goal: Full task lifecycle in the UI — create, edit, reorder, delete, promote from captures.

| # | What | Where |
|---|------|-------|
| 3.1 | **Inline task creation** — input at bottom of task list, Enter to create | `TodayMode.tsx` |
| 3.2 | **Task kind selector** — toggle must / personal / small when creating | `TodayMode.tsx` |
| 3.3 | **Click-to-edit** — click task text to edit inline, blur or Enter to save | `TodayMode.tsx` |
| 3.4 | **Delete/archive** — swipe left or X button, confirm, call DELETE | `TodayMode.tsx` |
| 3.5 | **Drag reorder** — drag handle to reorder, call POST /tasks/reorder | `TodayMode.tsx` |
| 3.6 | **Capture → task** — "Promote to task" button on each capture | `CaptureMode.tsx` |
| 3.7 | **Empty state** — when no tasks exist, show "Plan your day" prompt | `TodayMode.tsx` |
| 3.8 | **Loading state** — skeleton UI while fetching | `TodayMode.tsx` |

**Exit criteria:** User can plan their entire day from the Today tab without touching the terminal.

---

## Phase 4 — Seed Data & Demo Mode (3 days)

> Goal: New users see a realistic populated state on first launch, not empty screens.

| # | What | Where |
|---|------|-------|
| 4.1 | `store/seed.go` — insert realistic sessions, buckets, patterns for today | Backend |
| 4.2 | Seed 11 LLM sessions with varied statuses (open/closed/stalled/orphan) | `seed.go` |
| 4.3 | Seed 90 buckets covering 07:00–22:00 with realistic activity curves | `seed.go` |
| 4.4 | Seed 6 patterns (thrashing, crash, stuck, cold-start, overwork, open-loops) | `seed.go` |
| 4.5 | Seed 4 tasks, 4 captures, 1 tomorrow plan | `seed.go` |
| 4.6 | Only seed on first boot (check if `tasks` table is empty for today) | `seed.go` |
| 4.7 | `--demo` CLI flag to force re-seed | `main.go` |

**Exit criteria:** `go run ./cmd/cogload` → open app → all 5 modes show rich data immediately.

---

## Phase 5 — Data Collection: File Watcher (1 week)

> Goal: First real data source. Watch project directories, record file events, aggregate into buckets.

| # | What | Where |
|---|------|-------|
| 5.1 | `ingest/fswatcher.go` — watch configured directories via `fsnotify` | New file |
| 5.2 | Emit `file_save`, `file_create`, `file_delete` events into `raw_events` table | `fswatcher.go` |
| 5.3 | Debounce — batch file events per 2 seconds to avoid flooding | `fswatcher.go` |
| 5.4 | Ignore list — skip `node_modules/`, `.git/`, `target/`, build artifacts | `fswatcher.go` |
| 5.5 | `ingest/aggregator.go` — background goroutine, every 10 min, roll raw events into `buckets` | New file |
| 5.6 | Activity density scoring — count events per 10min, normalize to 0-100 | `aggregator.go` |
| 5.7 | Wire into `main.go` — start watcher + aggregator on boot | `main.go` |
| 5.8 | Config — `~/.cogload/config.toml` with `watch_paths = ["/path/to/project"]` | New `config/config.go` |

**Exit criteria:** Work on code for 1 hour → `buckets` table has 6 entries with real activity scores. Energy map shows actual work pattern.

---

## Phase 6 — Data Collection: Git + Idle (1 week)

> Goal: Track commits and inactivity to complete the activity picture.

| # | What | Where |
|---|------|-------|
| 6.1 | `ingest/gitmon.go` — poll `.git/refs/heads/` every 30s for new commits | New file |
| 6.2 | Emit `git_commit` events with hash, files_changed, insertions, deletions | `gitmon.go` |
| 6.3 | Emit `git_branch_switch` when HEAD changes | `gitmon.go` |
| 6.4 | `ingest/idle.go` — track last event timestamp, emit `idle_start` after 5min gap | New file |
| 6.5 | Emit `idle_end` when activity resumes | `idle.go` |
| 6.6 | Aggregator includes git commits and idle time in bucket scoring | `aggregator.go` |
| 6.7 | `ingest/coordinator.go` — start/stop all watchers, event bus | New file |

**Exit criteria:** Make 3 commits in an hour → `raw_events` has 3 `git_commit` entries. Take a break → `idle_start` event appears. Buckets reflect both.

---

## Phase 7 — Real-Time Signals (1.5 weeks)

> Goal: `ComputeSignals()` returns truth from real data, engine rules fire on real conditions.

| # | What | Where |
|---|------|-------|
| 7.1 | Replace `DefaultSignals()` — compute from last 30min of buckets + sessions | `engine.go` |
| 7.2 | Activity density → current bucket's score | `engine.go` |
| 7.3 | Error rate → count error events in last 30min vs morning baseline | `engine.go` |
| 7.4 | Session lifecycle — auto-mark stalled (30min no activity), orphan (1 msg, abandoned) | New `engine/sessions.go` |
| 7.5 | Thread counts — active, new-last-10min, orphan from session table | `engine.go` |
| 7.6 | Cognitive threshold — weighted: threads×15 + loops×10 + errorRate×10 | `engine.go` |
| 7.7 | Post-lunch crash — compare 13:00-15:00 buckets vs 09:00-11:00 peak | New `engine/patterns.go` |
| 7.8 | Thrashing — detect >5 sessions in 10min window with <3min avg | `patterns.go` |
| 7.9 | Stuck task — task open >90min with <20% progress (commits vs estimate) | `engine.go` |
| 7.10 | Broadcast real signals via WebSocket every 5s (already wired, now with real data) | `main.go` |

**Exit criteria:** Open 5 LLM sessions fast → signal strip shows "thrashing". Work past 16:30 → cutoff warning fires. Error rate spikes → fatigue rule triggers.

---

## Phase 8 — Data Collection: LLM Sessions (1.5 weeks)

> Goal: Track AI conversation threads automatically.

| # | What | Where |
|---|------|-------|
| 8.1 | `proxy/llmproxy.go` — HTTP reverse proxy on `:9201` | New file |
| 8.2 | Forward transparently to `api.anthropic.com` / `api.openai.com` | `llmproxy.go` |
| 8.3 | Log metadata only: timestamp, model, token count, session ID (NO content) | `llmproxy.go` |
| 8.4 | Auto-detect thread boundaries — new conversation vs continuation | `llmproxy.go` |
| 8.5 | Insert sessions into `sessions` table on first message | `llmproxy.go` |
| 8.6 | Update message_count on each interaction | `llmproxy.go` |
| 8.7 | `ingest/claudelogs.go` — parse `~/.claude/projects/` as fallback | New file |
| 8.8 | Config — proxy upstream URLs in `config.toml` | `config.go` |

**Exit criteria:** Set `ANTHROPIC_BASE_URL=http://localhost:9201` → use Claude → sessions appear in DB with message counts.

---

## Phase 9 — Pattern Detection & Review (1.5 weeks)

> Goal: Auto-generate daily review from real data.

| # | What | Where |
|---|------|-------|
| 9.1 | Pattern persistence — when detectors fire, insert into `patterns` table | `engine/patterns.go` |
| 9.2 | Energy leak calculator — gaps between productive buckets | New `engine/leaks.go` |
| 9.3 | Root cause inference — correlate patterns to causes | New `engine/rootcause.go` |
| 9.4 | Daily summary — deep work min, leaked min from buckets | New `engine/summary.go` |
| 9.5 | Review endpoint returns computed data, not hardcoded leaks | `router.go` |
| 9.6 | Multi-day trend storage for 7/30 day views | `store.go`, `models.go` |

**Exit criteria:** End of day → Review shows real deep work time, patterns from actual thrashing/fatigue, and genuine leaks.

---

## Phase 10 — Tomorrow Plan Generation (1 week)

> Goal: Auto-generate next day from today's audit.

| # | What | Where |
|---|------|-------|
| 10.1 | Plan generator — review + open loops + patterns → plan | New `engine/planner.go` |
| 10.2 | Constraint derivation — fatigue → cutoff, thrashing → cap | `planner.go` |
| 10.3 | Bandwidth adjustment — planned vs actual, auto-shift | `planner.go` |
| 10.4 | Task pre-selection from open loops | `planner.go` |
| 10.5 | Plan rollover at midnight | `planner.go` |

---

## Phase 11 — Live Interventions (1 week)

> Goal: Enforcement system goes live with real-time push.

| # | What | Where |
|---|------|-------|
| 11.1 | Push interventions via WS when rules fire | `engine.go`, `ws/hub.go` |
| 11.2 | Dismissal/snooze persisted in SQLite | `store.go` |
| 11.3 | Override with friction — hold-to-confirm | New frontend component |
| 11.4 | Blocker overlay for block-level interventions | New `Blocker.tsx` |
| 11.5 | Cold-start gate — block until plan exists | `App.tsx`, `engine.go` |

---

## Phase 12 — Settings & Configuration (1 week)

| # | What |
|---|------|
| 12.1 | Settings mode — 6th tab |
| 12.2 | Cutoff time, thread cap, bandwidth defaults |
| 12.3 | Watch paths, LLM proxy toggle |
| 12.4 | Rule enable/disable |
| 12.5 | `~/.cogload/config.toml` persistence |

---

## Phase 13 — Polish & Production (2 weeks)

| # | What |
|---|------|
| 13.1 | Loading skeletons, empty states |
| 13.2 | Error handling, retries, offline mode |
| 13.3 | Onboarding wizard on first launch |
| 13.4 | Proper macOS app icon |
| 13.5 | Tauri auto-updater |
| 13.6 | Native menu bar + tray icon |
| 13.7 | Performance optimization |
| 13.8 | Go unit tests + React component tests |

---

## Timeline

```
Phase 1  ─── CRUD ────────────────────── 1 week
Phase 2  ─── Wire Frontend ───────────── 1 week
Phase 3  ─── Task Management UX ──────── 1 week
Phase 4  ─── Seed Data ───────────────── 3 days
Phase 5  ─── FS Watcher ──────────────── 1 week
Phase 6  ─── Git + Idle ──────────────── 1 week
Phase 7  ─── Real-Time Signals ────────── 1.5 weeks
Phase 8  ─── LLM Session Tracking ────── 1.5 weeks
Phase 9  ─── Patterns & Review ────────── 1.5 weeks
Phase 10 ─── Tomorrow Generation ──────── 1 week
Phase 11 ─── Live Interventions ───────── 1 week
Phase 12 ─── Settings ────────────────── 1 week
Phase 13 ─── Polish ──────────────────── 2 weeks
```

**Usable app (Phases 1–4): ~3.5 weeks** — full CRUD, frontend wired, rich demo data.  
**Real data MVP (add Phases 5–7): ~7 weeks** — tracks file activity, git, idle. Signals are real.  
**Full product (all phases): ~15 weeks.**

---

## This Week — Phase 1

Start with **1A (Tasks CRUD)** — it's the smallest loop and proves the whole stack works end-to-end.

1. Add `POST /api/v1/tasks` + `PUT` + `DELETE` endpoints
2. Add `DeleteTask`, `UpdateTask` methods to store
3. Test with curl
4. Move to 1B (Captures), 1C (Focus sessions)
5. End of week: every entity has full CRUD
