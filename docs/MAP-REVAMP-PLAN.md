# Map Mode Revamp — Blocks + Map Merged

> Status: Planned  
> Last updated: 2026-05-25

---

## The Core Idea

The Map and Blocks tabs currently live in parallel but they track the same thing from different angles. **Map shows what needs to happen and in what order. Blocks show how much time you have and for what category.** Neither is complete without the other.

The revamp merges them: the canvas becomes the place where you run your day, not just plan it. Clicking a task node activates a right sidebar that is the full control panel — start, pause, set time, see accumulated budget. The graph itself shows live state: which task is running, which are locked by time rules, which are done.

---

## What changes at a glance

| Before | After |
|---|---|
| Map = dependency graph only | Map = dependency graph + active work surface |
| Blocks = separate tab with timeline | Blocks budget bar embedded in Map sidebar |
| Sidebar = dependency detail only | Sidebar = timer + time budget + dependency detail |
| No time awareness on canvas | Nodes reflect running / locked / available state |
| Lunch/cutoff are config values | Lunch/cutoff are visible markers on canvas that enforce rules |

Blocks tab **stays** but becomes a pure schedule view (when are my blocks, what's next). Map becomes the place where you actually work.

---

## Right Sidebar — The Control Panel

When no node is selected, the sidebar shows the day budget at a glance. When a node is selected, it becomes the full control panel for that task.

### Unselected state (ambient)

```
┌─────────────────────────────────────┐
│  Today's budget                     │
│                                     │
│  Work          ████████░░  2h 40m  │
│                          / 4h 00m  │
│  Side project  ████░░░░░  1h 10m  │
│                          / 2h 00m  │
│                                     │
│  ─────────────────────────────────  │
│  Time of day        2:47 PM        │
│  Workday ends       5:00 PM        │
│  Lunch              12:30–1:30 PM  │
│  ─────────────────────────────────  │
│  Select a task to start focusing   │
└─────────────────────────────────────┘
```

**Budget bars**: two rows (work, side project) from the BlockConfig allocations. Each shows accumulated time today as a fill bar, with the target from the allocation. Color: `--color-action-blue` for side project, `--color-ink` for work. The bars update in real time while a task is running.

### Selected state (task active)

```
┌─────────────────────────────────────┐
│  ← back                             │
│                                     │
│  must                               │
│  Refactor auth module               │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  45:00                      │   │  ← countdown
│  │  remaining of 90m           │   │
│  │  ████████████░░░░░░░░░░░░   │   │  ← progress bar
│  └─────────────────────────────┘   │
│                                     │
│  Duration  [──────────90m──────]   │  ← editable slider
│            15m  30m  45m  90m 2h   │
│                                     │
│  [  ▶ Start  ]  or  [ ❙❙ Pause ]  │
│                                     │
│  ─────────────────────────────────  │
│  Today on Work                     │
│  ████████████░░░░░  2h 40m / 4h   │
│                                     │
│  ─────────────────────────────────  │
│  Blocked by  2 tasks               │
│  • Set up database schema    →     │
│  • Write migration scripts   →     │
└─────────────────────────────────────┘
```

**Countdown timer**: large, tabular-numeral display of remaining time. Same visual language as the old FocusMode timer but smaller (36px) since it lives in a sidebar. Uses the existing `focus` store — `tickFocus` runs globally, same as before.

**Duration slider**: horizontal scrubber with preset stops at 15, 30, 45, 60, 90, 120 minutes. Clicking a stop snaps to it. The slider updates `focus.remainingSecs` before starting. This replaces the hardcoded 90-minute assumption.

**Start / Pause**: primary button. Start calls `api.startFocus(task.id)` and `store.startFocus(task.text)`. Pause calls `api.stopFocus("paused")` and `store.pauseFocus()`. The button label and icon toggle.

**Category accumulator**: below the timer, one bar showing how much time has accumulated today in this task's category (work or side project) versus the allocation target. This is the "cognitive budget meter" — you can see at a glance how much of your work budget is left while you're working.

**Dependency list**: compact version at the bottom. Shows blocked-by tasks as clickable links that select that node on the canvas.

---

## Canvas Time Markers

Two vertical bands overlaid on the canvas background — not on the nodes, on the React Flow `<Background>` layer as SVG overlays rendered via a custom React Flow component.

### How they work

The markers are drawn as absolutely-positioned divs behind the canvas nodes (CSS `z-index: 0`, below nodes which are `z-index: 1`). They track the current time and config.

```
Canvas (7am → 10pm scale, horizontal)
│
│   ░░░░░░░░    ████████████████    ░░ | ░░░░░░░░░   ░░░░
│              │                   │   │            │
│   before     │   work hours      │   │  personal  │
│   work       │   (9am - 5pm)     │   │  only zone │
│              │ 🥪 12:30-1:30      │   │            │
│              │  (blink when now) │   │            │
```

This is **not** an accurate timeline — the canvas is a freeform 2D space where nodes can be anywhere. Instead the markers are:

1. A **top status bar** inside the canvas (not the app toolbar) — a thin 24px strip at the top of the React Flow panel showing the day timeline with current time marker.

2. **Node state overlays**: nodes whose task category is locked by a time rule get a visual indicator on the node itself (a thin amber top border + lock icon in the kind label area). They cannot be started.

### Lunch enforcement

When `now >= lunchStart && now < lunchEnd`:
- If a task is currently running → automatically paused (the timer stops, the node transitions to paused state)
- The sidebar shows a "Lunch break" card instead of the task controls
- All Start buttons are disabled
- The in-canvas status bar shows a blinking "🥪 Lunch" indicator (CSS `animation: blink 1s step-end infinite`)
- A countdown to lunch end is shown in the sidebar

### Work cutoff enforcement

When `now >= cutoffHour`:
- Tasks with `kind === "must"` (work category) get `locked` state on their nodes — amber border, lock icon, Start button disabled
- Tasks with `kind === "personal"` or `kind === "small"` remain startable
- The in-canvas status bar shows "Work done · personal only" in amber

These rules are **front-end only** — the backend already has `CUTOFF.PAST` intervention for the signal strip, but the locking here is visual and behavioral in the map component. The backend is not queried for this — the frontend computes it from `config.cutoff_hour`, `config.lunch_start`, `config.lunch_end`, and `Date.now()`.

---

## In-Canvas Status Bar

A thin strip at the top of the React Flow canvas (inside the canvas div, absolutely positioned):

```
┌──────────────────────────────────────────────────────────────────┐
│  9AM         12PM    🥪 12:30        3PM          5PM ✂ cutoff  │
│  ──────────────────────────────────────────────────────────────  │
│                              ▲ now (2:47 PM)                     │
└──────────────────────────────────────────────────────────────────┘
```

- Full-width, 32px tall, `position: absolute; top: 0; left: 0; right: 0; z-index: 4`
- Shows proportional hour marks from `workday_start` to `workday_end`  
- Lunch block shaded in amber — **blinking border** when inside lunch window
- Cutoff mark as a dashed vertical line
- Current time as a blue triangle / caret
- When inside lunch: the entire bar border pulses with `animation: lunch-blink 1s step-end infinite`
- When past cutoff: the right section turns a muted amber

---

## Time Accumulation

The frontend tracks accumulated time per category **locally** using `sessionStorage` keyed by `YYYY-MM-DD`. Every second that a task is running, the category's accumulated seconds increment. This is reset at midnight.

Structure: `cogload_time_today = { work: 9340, side_project: 4200 }` (seconds)

This feeds the budget bars in the sidebar without requiring a backend round-trip. When the page reloads, it's re-read from sessionStorage. The backend's `buckets` table is the source of truth for historical review, but the real-time sidebar uses this local counter.

**Why not the backend?** The bucket system aggregates every 10 minutes. The sidebar needs second-by-second updates for the live fill bar. A local counter is the right tool.

---

## Node states on canvas

| State | Visual |
|---|---|
| `idle` (ready to start) | White background, `--color-stone` border |
| `running` | Blue left border (`--color-action-blue`), pulsing dot |
| `paused` | Amber left border, pause icon replaces dot |
| `done` | Muted, strikethrough text, grey border |
| `blocked` (dependency not met) | Grey background, lock icon |
| `locked-work` (past cutoff, work task) | Amber top border, lock icon, no start button |
| `locked-lunch` (lunch window active) | All nodes except running show "paused by lunch" |

---

## Implementation Phases

### Phase A — Sidebar control panel (3 days)

**Files changed:**

| File | Change |
|---|---|
| `MapMode.tsx` | Replace `DetailPanel` with `TaskControlPanel` component |
| `MapMode.tsx` | Add `ambientSidebar` (budget view when nothing selected) |
| `app-store.ts` | Re-enable `tickFocus` from App.tsx — needs to run globally again |
| `map.css` | New `.mcp-*` classes for the control panel |

**`TaskControlPanel` props:**
```typescript
interface TaskControlPanelProps {
  task: Task;
  edges: TaskEdge[];
  tasks: Task[];
  focusState: FocusState;
  timeAccumulated: Record<string, number>; // category → seconds
  blockConfig: BlockConfig;
  onStartFocus: (taskId: string, durationSecs: number) => void;
  onPauseFocus: () => void;
  onDeleteEdge: (id: string) => void;
  onSelectTask: (id: string) => void;
  onClose: () => void;
}
```

**Duration presets** (in seconds): `[900, 1800, 2700, 3600, 5400, 7200]` = 15m, 30m, 45m, 1h, 1.5h, 2h. Default: 5400 (90m).

**`AmbientSidebar` props:**
```typescript
interface AmbientSidebarProps {
  timeAccumulated: Record<string, number>;
  blockConfig: BlockConfig;
  now: Date;
  lunchStart: number;
  lunchEnd: number;
  cutoffHour: number;
}
```

### Phase B — Time accumulation (1 day)

**Files changed:**

| File | Change |
|---|---|
| `MapMode.tsx` | Add `useTimeAccumulator` hook — reads/writes sessionStorage, increments on tick when focus is active |
| `app-store.ts` | Restore `tickFocus` global interval (was removed when FocusMode was deleted — needs to come back for the countdown to work in Map) |

```typescript
// useTimeAccumulator hook
function useTimeAccumulator(
  focusTask: string | null,
  focusIsPaused: boolean,
  taskCategory: (taskText: string) => string,
) {
  // Returns: { accumulated: Record<string, number>, tick: () => void }
}
```

### Phase C — In-canvas status bar (2 days)

**Files changed:**

| File | Change |
|---|---|
| `MapMode.tsx` | Add `<DayTimeline>` component inside `<ReactFlow>` as an absolute overlay |
| `map.css` | `.day-timeline-*` classes with blink animations |

**`DayTimeline` component**: purely presentational, receives `now`, `workdayStart`, `workdayEnd`, `lunchStart`, `lunchEnd`, `cutoffHour`. Renders a proportional strip.

```
const widthPct = (h: number) => ((h - workdayStart) / (workdayEnd - workdayStart)) * 100
```

### Phase D — Time-rule enforcement (1 day)

**Files changed:**

| File | Change |
|---|---|
| `MapMode.tsx` | Add `isTaskLocked(task, now, config)` utility — returns `"lunch" | "cutoff" | null` |
| `TaskNode.tsx` | Accept `locked: "lunch" | "cutoff" | null` in `TaskNodeData` |
| `MapMode.tsx` | Pass computed `locked` state into each node's data on every clock tick |
| `MapMode.tsx` | Auto-pause focus when lunch starts |

**`isTaskLocked` logic:**
```typescript
function isTaskLocked(
  task: Task,
  nowHour: number,
  lunchStart: number,
  lunchEnd: number,
  cutoffHour: number,
): "lunch" | "cutoff" | null {
  if (nowHour >= lunchStart && nowHour < lunchEnd) return "lunch";
  if (nowHour >= cutoffHour && task.kind === "must") return "cutoff";
  return null;
}
```

---

## Files changed (full list)

| File | Change |
|---|---|
| `frontend/src/components/modes/MapMode.tsx` | Major rewrite of sidebar; add DayTimeline, time accumulator, lock logic |
| `frontend/src/components/shared/TaskNode.tsx` | Add `locked`, `paused` states; update node CSS classes |
| `frontend/src/store/app-store.ts` | Restore `tickFocus` to the app-level interval |
| `frontend/src/App.tsx` | Restore `tickFocus` interval (removed when FocusMode was deleted) |
| `frontend/src/styles/map.css` | New `.mcp-*` (control panel), `.day-timeline-*`, `.tnode--paused`, `.tnode--locked-*` classes |

---

## Design Principles

1. **The canvas does not move.** No timeline scrolling, no zoom-to-time. The node positions are freeform and stay freeform. Only the thin status bar at the top is time-proportional.

2. **The sidebar is the only place that changes.** The canvas is stable. Clicking a node changes the sidebar, not the canvas.

3. **Time rules are visible before they fire.** The status bar always shows where lunch and cutoff are. A node shows its locked state before you try to start it.

4. **Lunch is mandatory, cutoff is enforced by category.** There is no "dismiss lunch" option. Cutoff locks work tasks but not personal/side project tasks — because the system knows the difference.

5. **Accumulated time is honest.** The budget bars show only time you actively focused (timer was running). Idle time when a task is selected but paused does not count.
