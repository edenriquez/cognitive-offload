# Cogload — V2 Roadmap: Cognitive Output Intelligence

> Last updated: 2025-05-07
> Strategy: **measure what matters** — connect raw activity to real output, then make the system adaptive.

## V1 Recap

V1 delivered the infrastructure: CRUD, data collection (files, git, Claude, Zed, idle), real-time signals, pattern detection, daily review, plan generation, settings, and polish. The raw observability pipeline is solid.

**What V1 answers:** "Are you overloaded right now?" (signals, interventions)
**What V1 can't answer:** "How did you actually spend your cognitive budget? What did your AI sessions produce? When did you cross the line from productive to exhausted?"

## The E-Bike Problem

AI-assisted development is like an e-bike. Each pedal stroke covers more ground, so you keep going. The exhaustion doesn't come from difficulty — it comes from accumulated momentum. You don't feel tired until you stop. Cogload V2 measures the *momentum* — not just the speed — and tells you when to stop before you crash.

---

## Current State (post-V1)

| Layer | What exists | What's missing |
|-------|-------------|----------------|
| **Raw events** | File saves, git commits, Claude prompts, Zed threads, idle transitions | No project grouping, no output correlation |
| **Sessions** | Lifecycle tracking (open/closed/stalled), message counts | No productivity scoring, no output attribution |
| **Buckets** | 10-min activity density, file saves, sessions, errors | `idle_sec` always 0, no per-project split |
| **Signals** | 17 real-time metrics, 11 intervention rules | `cognitive_threshold_pct` computed but never shown, error chain dormant |
| **Patterns** | 5 detectors (perf-degradation, crash, fatigue, stuck, open-loops) | No diminishing-returns, no velocity decay, no momentum tracking |
| **Review** | Summary stats, energy map, patterns, leaks, root causes, sessions | No per-project breakdown, no session output scoring, no trend view |
| **Planning** | Constraints from patterns, bandwidth adjustment, task carryover | Budget is static, no actual-vs-planned, no project-level allocation |
| **Self-reports** | Stored with timestamp and level | Never used in any computation or correlation |
| **Focus sessions** | Duration and outcome tracked | Only used for stuck-task detection, not in review or productivity metrics |

### Dormant features (built but unused)

| Feature | Status | V2 impact |
|---------|--------|-----------|
| `cognitive_threshold_pct` | Computed every 5s, never rendered | Becomes the headline cognitive load gauge |
| `FocusSession` history | API + type defined, no component uses it | Powers per-task time tracking in review |
| `TodayResponse.completed/total` | Backend sends, frontend ignores | Task completion progress in Today mode |
| `file_saves` per bucket | Collected, not in energy map tooltip | Proxy for real code output |
| Session `ended_at` + duration | Stored, never displayed | Session duration in review table |
| Pattern `evidence` field | Stored with data, never rendered | Explains why patterns were detected |
| Self-reports in engine | Stored, never factored into signals/patterns/planning | Subjective state should influence recommendations |

---

## Phase 14 — Project Detection & Attribution (1.5 weeks)

> Goal: The system knows which project you're working on at any given moment.

| # | What | Where |
|---|------|-------|
| 14.1 | **Project model** — `projects` table: id, name, path, kind (work/personal/side), color | `store.go`, `models.go` |
| 14.2 | **Auto-detect projects** — scan `WatchPaths` for git roots, infer project name from directory | `ingest/projects.go` (new) |
| 14.3 | **Tag events with project** — file saves → match path to project, sessions → match `project`/`cwd` metadata to project | `fswatcher.go`, `claudewatcher.go`, `claudeprojects.go` |
| 14.4 | **Tag sessions with project** — add `project_id` column to `sessions` table, populate from metadata on upsert | `store.go`, watchers |
| 14.5 | **Tag buckets with project** — split the aggregator so each project gets its own bucket row, plus a global rollup | `aggregator.go` |
| 14.6 | **Project CRUD API** — `GET/POST/PUT/DELETE /api/v1/projects` | `router.go` |
| 14.7 | **Settings: project management** — list detected projects, assign kind (work/personal/side), set color | `SettingsMode.tsx` |

**Exit criteria:** Every file save, git commit, and Claude session is tagged with a project. `GET /api/v1/projects` returns all projects with today's event counts per project.

---

## Phase 15 — Performance Budget System (1.5 weeks)

> Goal: "I want to spend 50% on work, 50% on personal" — and the system tracks actual vs. planned.

| # | What | Where |
|---|------|-------|
| 15.1 | **Daily budget model** — `budgets` table: day, allocations JSON `[{project_id, pct}]` | `store.go`, `models.go` |
| 15.2 | **Budget API** — `GET/PUT /api/v1/budget` — set today's allocation per project | `router.go` |
| 15.3 | **Actual computation** — compute time-per-project from tagged buckets: sum active bucket minutes per project, derive actual % | `engine/budget.go` (new) |
| 15.4 | **Budget widget in Today mode** — horizontal bars showing planned % vs actual % per project, live-updating | `TodayMode.tsx` |
| 15.5 | **Budget setup in onboarding** — after cutoff hour step, add "How do you want to split today?" with project sliders | `Onboarding.tsx` |
| 15.6 | **Budget deviation signal** — new signal: `budget_deviation_pct` per project. Fire `REPLAN.BUDGET_DRIFT` intervention when any project exceeds allocation by >20% | `engine.go` |
| 15.7 | **Replace static bandwidth** — `TodayResponse.bandwidth` reads from budget instead of hardcoded `{60,15,15,10}` | `router.go`, `TodayMode.tsx` |

**Exit criteria:** Set a 50/50 budget. Work on project A for 2 hours, project B for 1 hour. Budget widget shows "A: 66% actual / 50% planned · B: 33% actual / 50% planned". Intervention fires for A.

---

## Phase 16 — Session Productivity Scoring (1.5 weeks)

> Goal: Know which AI sessions produced real output and which were spinning wheels.

| # | What | Where |
|---|------|-------|
| 16.1 | **Session output window** — for each session, compute: file saves and git commits within ±5 min of session activity | `engine/session_score.go` (new) |
| 16.2 | **Productivity score** — `output_score = (file_saves + commits × 3) / max(1, message_count)` normalized 0–100 | `engine/session_score.go` |
| 16.3 | **Session score persistence** — add `output_score`, `file_saves_in_window`, `commits_in_window` columns to `sessions` | `store.go` |
| 16.4 | **Compute on session close** — when a session transitions to `closed`, compute and store its score | `engine/session_score.go`, watchers |
| 16.5 | **Batch recompute on review** — recompute scores for all today's sessions when review is opened | `engine/session_score.go` |
| 16.6 | **Session score in Review** — add score column to sessions table, color-code (green ≥60, yellow 30–59, red <30) | `ReviewMode.tsx` |
| 16.7 | **High-leverage vs. spinning-wheels callout** — in review summary, show "3 high-leverage sessions (avg 72/100), 2 low-output sessions (avg 12/100)" | `ReviewMode.tsx` |
| 16.8 | **Root cause: low-output sessions** — new pattern: if >50% of sessions score <30, fire "high-AI-interaction-low-output" pattern | `engine/patterns.go` |

**Exit criteria:** End of day review shows each session with a productivity score. Sessions with 40 messages and 0 saves are flagged red. Sessions with 5 messages and 12 saves are green.

---

## Phase 17 — Cumulative Momentum Tracker (1 week)

> Goal: Track the running total of cognitive throughput and detect when you've crossed the e-bike wall.

| # | What | Where |
|---|------|-------|
| 17.1 | **Momentum model** — running counters updated on each event: `total_messages`, `total_sessions`, `total_saves`, `total_commits`, `active_minutes` | `engine/momentum.go` (new) |
| 17.2 | **Momentum signal** — new field in `SignalSnapshot`: `momentum` object with running totals + `velocity` (events/hour for last 30 min) + `acceleration` (velocity change) | `engine.go`, `models.go` |
| 17.3 | **Momentum chart in Review** — area chart showing cumulative messages/sessions through the day, with self-report dots overlaid. The inflection point where output plateaus but sessions keep climbing = the e-bike wall | `ReviewMode.tsx` |
| 17.4 | **Velocity decay detection** — compare output-per-message for morning (first 3h) vs current hour. If ratio drops >50%, fire `LOAD.DIMINISHING_RETURNS` intervention | `engine.go` |
| 17.5 | **Status bar momentum indicator** — show current velocity in the status bar: "↑ 14 events/h" or "↓ 3 events/h (was 18)" | `App.tsx` |
| 17.6 | **Self-report correlation** — when computing day summary, correlate self-report timestamps with momentum velocity. Show "You reported 'degraded' at 4:15pm — momentum had been declining for 90 minutes before that" | `engine/summary.go`, `ReviewMode.tsx` |

**Exit criteria:** Momentum chart shows the day's cumulative curve. You can visually see where you hit the wall. The system detects the inflection point and warns you before your self-report catches up.

---

## Phase 18 — Per-Project Output Dashboard (1 week)

> Goal: "Project A: 7 sessions → 23 saves, 4 commits. Project B: 4 sessions → 3 saves, 0 commits."

| # | What | Where |
|---|------|-------|
| 18.1 | **Project summary computation** — per project: sessions count, total messages, file saves, git commits, active minutes, avg session score | `engine/project_summary.go` (new) |
| 18.2 | **Project cards in Review** — one card per active project showing all metrics, color-coded by project kind | `ReviewMode.tsx` |
| 18.3 | **Project energy map** — per-project mini energy map (stacked or tabbed) showing when each project was active | `ReviewMode.tsx` |
| 18.4 | **Budget vs. actual in Review** — side-by-side bars: "Planned 50% / Actual 66%" per project with over/under coloring | `ReviewMode.tsx` |
| 18.5 | **Project breakdown in plan generation** — tomorrow's plan references which projects drifted and adjusts recommendations: "Yesterday you over-invested in Project A by 16%. Consider front-loading Project B tomorrow." | `engine/planner.go` |

**Exit criteria:** Review shows distinct project cards with output metrics. You can see at a glance which project got your best cognitive hours and which got the dregs.

---

## Phase 19 — Activate Dormant Features (1 week)

> Goal: Light up everything V1 built but never connected.

| # | What | Where |
|---|------|-------|
| 19.1 | **Cognitive load gauge** — render `cognitive_threshold_pct` as a prominent gauge in the signal strip or Today mode header | `App.tsx` or `TodayMode.tsx` |
| 19.2 | **Focus session history in Review** — fetch `focusHistory()`, show focus blocks with task, duration, and outcome | `ReviewMode.tsx` |
| 19.3 | **Task completion progress** — use `completed/total` from API in Today mode as a progress ring or bar | `TodayMode.tsx` |
| 19.4 | **Dynamic day counter** — compute day number from first-use date, replace hardcoded "day 14" | `TodayMode.tsx`, store or config |
| 19.5 | **Dynamic cutoff/productive text** — replace hardcoded "Cutoff · 16:30 · Productive · 6h" with values from config + actual computed productive hours | `TodayMode.tsx` |
| 19.6 | **Session duration column** — show `ended_at - started_at` as duration in the review sessions table | `ReviewMode.tsx` |
| 19.7 | **Pattern evidence expandable** — click a pattern to see its `evidence` JSON rendered as key-value pairs | `ReviewMode.tsx` |
| 19.8 | **Self-reports in engine** — factor self-reports into fatigue detection: if user reports ≥4 (tired/degraded), boost fatigue signal weight and lower intervention thresholds | `engine.go` |
| 19.9 | **Idle seconds in aggregator** — compute `idle_sec` per bucket from idle_start/idle_end events instead of always writing 0 | `aggregator.go` |
| 19.10 | **Error event emission** — detect error-like patterns from file watcher (rapid save-delete cycles) or session metadata and emit `kind="error"` events to activate the dormant error-rate signal chain | `fswatcher.go` or new `ingest/errordetect.go` |

**Exit criteria:** Every metric that's computed but hidden is now visible. Every column that's stored but empty is now populated. The cognitive load gauge is front and center.

---

## Phase 20 — Daily Intelligence Report (1.5 weeks)

> Goal: Not just data — a narrative. "Here's what happened today, here's what it means, here's what to change."

| # | What | Where |
|---|------|-------|
| 20.1 | **Report template engine** — generate a structured markdown daily report from review data, project summaries, momentum, budget, patterns | `engine/report.go` (new) |
| 20.2 | **Report sections**: What you accomplished (per project), Where time went (budget actual vs planned), Cognitive arc (momentum curve summary), Patterns detected, What to change tomorrow | `engine/report.go` |
| 20.3 | **Report endpoint** — `GET /api/v1/report/{day}` returns the generated report | `router.go` |
| 20.4 | **Report view in Review mode** — collapsible section at the top of Review showing the narrative report | `ReviewMode.tsx` |
| 20.5 | **E-bike wall callout** — if momentum decay was detected, include: "Your output-per-message dropped 60% after 3pm. You kept opening sessions but producing less. The e-bike wall hit at approximately {time}." | `engine/report.go` |
| 20.6 | **Suggestion engine** — based on patterns + budget drift + momentum data, generate 3 actionable suggestions: specific, measurable, tied to data | `engine/suggestions.go` (new) |
| 20.7 | **Feed suggestions into tomorrow's plan** — auto-generate constraints from suggestions, not just from pattern templates | `engine/planner.go` |

**Exit criteria:** Open review and see a human-readable narrative of your day: what you did, where you drifted, when you hit the wall, and 3 concrete things to change tomorrow.

---

## Phase 21 — Multi-Day Trends (1 week)

> Goal: "Am I getting better?" — weekly and monthly views.

| # | What | Where |
|---|------|-------|
| 21.1 | **Trend storage** — `daily_summaries` table: day, deep_work_min, leaked_min, sessions_count, avg_session_score, momentum_peak, wall_time, budget_adherence_pct | `store.go` |
| 21.2 | **End-of-day persistence** — when review is first accessed after 20:00 (or next morning), snapshot the day's computed summary into `daily_summaries` | `engine/summary.go` |
| 21.3 | **Trend API** — `GET /api/v1/trends?days=7` and `GET /api/v1/trends?days=30` | `router.go` |
| 21.4 | **Weekly trend chart** — line chart showing deep work min, leaked min, session score avg over the last 7 days | `ReviewMode.tsx` or new `TrendsMode.tsx` |
| 21.5 | **Pattern frequency heatmap** — which patterns fire most often? Are you improving or repeating? | `TrendsMode.tsx` |
| 21.6 | **Budget adherence trend** — are you getting better at sticking to your planned allocation? | `TrendsMode.tsx` |
| 21.7 | **E-bike wall time trend** — plot what time-of-day you hit the wall each day. Is it getting earlier (bad) or later (adapting)? | `TrendsMode.tsx` |

**Exit criteria:** New Trends tab shows a 7-day view. You can see your deep work increasing, your wall time shifting later, and your budget adherence improving (or not).

---

## Timeline

```
Phase 14 ─── Project Detection ────────── 1.5 weeks
Phase 15 ─── Performance Budget ───────── 1.5 weeks
Phase 16 ─── Session Scoring ──────────── 1.5 weeks
Phase 17 ─── Momentum Tracker ─────────── 1 week
Phase 18 ─── Project Dashboard ────────── 1 week
Phase 19 ─── Activate Dormant ─────────── 1 week
Phase 20 ─── Intelligence Report ──────── 1.5 weeks
Phase 21 ─── Multi-Day Trends ─────────── 1 week
```

**Core intelligence (14–17): ~5.5 weeks** — project attribution, budget tracking, session scoring, momentum detection.
**Full output dashboard (add 18–19): ~7.5 weeks** — per-project cards, all dormant features activated.
**Complete V2 (all phases): ~10.5 weeks** — narrative daily reports, multi-day trends, the full cognitive output intelligence layer.

---

## Principles

1. **Measure output, not input.** Sessions opened and messages sent are input. File saves, commits, and task completion are output. The ratio is what matters.
2. **Adapt, don't limit.** V1 removed thread caps. V2 continues this — no hard blocks on behavior. Show the data, surface the pattern, suggest the change. The human decides.
3. **The e-bike wall is real.** The system's job is to detect the inflection point where productive momentum becomes exhausting momentum, and flag it before the user's self-awareness catches up.
4. **Per-project truth.** "I worked hard today" is meaningless without "on what?" Every metric should decompose by project.
5. **Narrative over numbers.** A dashboard of 20 metrics is noise. A paragraph that says "You over-invested in Project A and hit the wall at 3pm" is signal.
