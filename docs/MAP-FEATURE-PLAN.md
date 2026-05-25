# Map Mode — Task Dependency Graph

> Status: Planned  
> Last updated: 2026-05-25

## What it is

A visual canvas tab that shows every task as a node and lets you draw dependency edges between them. The graph is the cognitive load — you can see at a glance what is blocking what, which tasks are roots (nothing blocks them), which are deep leaves (blocked by many things), and how much of your day is genuinely free to start.

The primary interaction is not configuration. It is understanding:
> "I cannot start B until A is done. If A is stuck, my whole chain stalls."

---

## The mental model

Tasks today exist in two relationships:

| Relationship | Meaning | Edge direction |
|---|---|---|
| **Blocks** | Task A must be done before Task B can start | A → B |
| **Subtask of** | Task B is a decomposition of Task A | A → B (dashed) |

The graph makes both visible. You drag from one task node to another to create an edge. The system infers the kind from context (same-day children → subtask, cross-task → blocks).

---

## Data model

### New table: `task_edges`

```sql
CREATE TABLE IF NOT EXISTS task_edges (
    id         TEXT PRIMARY KEY,
    source_id  TEXT NOT NULL,   -- the task that blocks / is the parent
    target_id  TEXT NOT NULL,   -- the task that is blocked / is the child
    kind       TEXT NOT NULL DEFAULT 'blocks',  -- 'blocks' | 'subtask'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE(source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_task_edges_source ON task_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_task_edges_target ON task_edges(target_id);
```

### Extended `Task` type (frontend)

```typescript
export interface Task {
  id: string;
  day: string;
  kind: "must" | "personal" | "small";
  idx: number;
  text: string;
  done: boolean;
  // New — populated when fetching for the map
  parent_id?: string;        // shorthand for the primary subtask-of edge
  blocked_by?: string[];     // ids of tasks that must complete first
  blocks?: string[];         // ids of tasks this one unblocks
}

export interface TaskEdge {
  id: string;
  source_id: string;
  target_id: string;
  kind: "blocks" | "subtask";
  created_at: string;
}

export interface TaskGraph {
  tasks: Task[];
  edges: TaskEdge[];
}
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/map` | Returns `TaskGraph` for today (tasks + all edges) |
| `POST` | `/api/v1/map/edges` | Create an edge `{ source_id, target_id, kind }` |
| `DELETE` | `/api/v1/map/edges/:id` | Delete an edge |
| `GET` | `/api/v1/map/ready` | Returns task IDs that are unblocked (all dependencies done) |

The `/map` endpoint is the only one MapMode needs. It fetches once on mount, then uses local state for optimistic updates while the user draws edges.

---

## Frontend: `MapMode.tsx`

**Library:** `@xyflow/react` (React Flow v12 — the maintained package name)

```
npm install @xyflow/react
```

### Three-panel layout

```
┌─────────────────────────────────────────────────────┐
│  TOOLBAR  [Kind filter] [Auto-layout] [Clear edges]  │
├──────────────────┬──────────────────────────────────┤
│                  │                                   │
│   CANVAS         │   DETAIL PANEL                   │
│   (React Flow)   │   (shown when node selected)     │
│                  │   - task text                    │
│                  │   - kind badge                   │
│                  │   - blocked by: [list]           │
│                  │   - blocks: [list]               │
│                  │   - remove edge buttons          │
│                  │                                   │
└──────────────────┴──────────────────────────────────┘
```

The canvas is 70% width, the detail panel is 30% — it only renders when a node is selected.

### Node visual design

Each task is a card node. The design follows the existing system — no external component library, just CSS matching `globals.css` tokens:

```
┌──────────────────────────────┐
│  ● must                      │  ← kind indicator dot (color)
│  Refactor auth module        │  ← task text
│  ████░░░░  60min est.        │  ← cognitive load bar (if estimate exists)
└──────────────────────────────┘
```

Node states:

| State | Visual |
|---|---|
| `done` | Muted, strikethrough text, grey border |
| `blocked` (has incomplete deps) | Amber left border, lock icon |
| `ready` (all deps done or no deps) | Normal |
| `active` (currently in focus) | Blue left border, pulsing dot |
| `selected` | Elevated shadow, ink border |

### Edge visual design

| Kind | Style |
|---|---|
| `blocks` | Solid arrow, `--color-carbon` |
| `subtask` | Dashed arrow, `--color-lead` |

Edges animate on hover (stroke brightens). No animated dashes — too distracting.

### Interaction model

**Creating an edge:**  
Hover a node → a small `+` handle appears on the right edge. Drag from that handle to another node. On drop, a small popover appears: "blocks" or "subtask of" — pick one, edge is created. If you drop on empty canvas, nothing happens.

**Deleting an edge:**  
Click an edge → it highlights. Delete key or the ✕ button in the detail panel removes it.

**Moving nodes:**  
Drag freely. Position is saved to `localStorage` keyed by `task_id` so the layout persists across sessions without a backend round-trip.

**Auto-layout:**  
Toolbar button triggers a dagre top-down layout (tasks with no dependencies at top, deepest leaves at bottom). This is computed client-side using `dagre` (already a transitive dep of React Flow).

---

## Cognitive load integration

The map is not just a planning tool — it feeds back into the existing signal system.

### Blocked task count signal

Add `blocked_tasks` to `SignalSnapshot`:

```go
// In ComputeSignals — count tasks that have incomplete dependencies
blockedCount := countBlockedTasks(ctx, db, today)
s.BlockedTasks = blockedCount
```

A task is "blocked" if any of its `source_id` edges points to an incomplete task. This count is shown in the signal strip as a new indicator and used in the `LOAD.STUCK` rule to distinguish "stuck on a hard task" from "stuck because a dependency isn't done."

### Ready queue

`GET /api/v1/map/ready` returns the subset of today's tasks that have no incomplete blockers. TodayMode can use this to highlight the "The one thing right now" — not just the first undone must-task, but the first **unblocked** must-task.

### Tomorrow plan generation

When generating tomorrow's plan, `planner.go` checks for tasks with edges that cross day boundaries (a task carried over that blocks others). These are surfaced as constraints:
> "Complete 'Refactor auth' first — 3 tasks depend on it."

---

## Implementation phases

### Phase A — Data layer (2 days)

1. Add `task_edges` table to `store.go` migration
2. Add `ListEdges(day)`, `CreateEdge(source, target, kind)`, `DeleteEdge(id)` to store
3. Add `GET /api/v1/map`, `POST /api/v1/map/edges`, `DELETE /api/v1/map/edges/:id` to router
4. Add `TaskEdge`, `TaskGraph` types to `models.go` and `types/index.ts`
5. Add `api.getTaskGraph()`, `api.createEdge()`, `api.deleteEdge()` to `client.ts`

**Exit criteria:** `curl /api/v1/map` returns `{ tasks: [...], edges: [] }`. Create an edge via curl, verify it persists and appears in the next GET.

---

### Phase B — Canvas (4 days)

1. `npm install @xyflow/react`
2. Create `MapMode.tsx` — loads graph, renders React Flow canvas
3. Build `TaskNode.tsx` — custom node component matching the design system
4. Wire node positions to `localStorage`
5. Implement edge creation: drag from handle → popover → `api.createEdge()`
6. Implement edge deletion: click edge → delete key or panel button
7. Add `MapMode` to `MODES` array and `Mode` type as `"map"`
8. Import `@xyflow/react/dist/style.css`, override variables to match design tokens

**Exit criteria:** Open Map, see today's tasks as draggable nodes. Draw an edge between two tasks. Refresh — edge persists.

---

### Phase C — Auto-layout + detail panel (2 days)

1. Install `dagre` (or use `@dagrejs/dagre` which is already a React Flow peer dep)
2. Implement `autoLayout(nodes, edges)` using dagre's `TB` (top-to-bottom) ranking
3. Build detail panel — renders on node click, shows blocked-by/blocks lists with remove buttons
4. Add "ready" highlighting — call `/api/v1/map/ready` and mark those nodes
5. Add cognitive load bar to nodes if `TaskEstimate` exists for the task

**Exit criteria:** Click "Auto-layout" → graph rearranges into a clear hierarchy. Click a node → detail panel shows its dependencies. Nodes with no blockers are visually distinct.

---

### Phase D — Signal integration (1 day)

1. Add `blocked_tasks` to `SignalSnapshot` in `engine.go` and `models.go`
2. Update `ComputeSignals` to count blocked tasks
3. Expose in signal strip (small indicator, not prominent)
4. Update TodayMode "The one thing right now" to use the first **unblocked** undone must-task

**Exit criteria:** Mark task A as blocking task B. Task B shows as blocked in signal strip. "The one thing" in TodayMode shows A (the unblocked root), not B.

---

## File write scope

| File | Change |
|---|---|
| `backend/internal/store/store.go` | New table + 3 methods |
| `backend/internal/api/router.go` | 3 new endpoints |
| `backend/internal/models/models.go` | `TaskEdge`, `TaskGraph` types |
| `backend/internal/engine/engine.go` | `blocked_tasks` signal |
| `frontend/src/types/index.ts` | `TaskEdge`, `TaskGraph`, extend `Task` |
| `frontend/src/api/client.ts` | 3 new methods |
| `frontend/src/components/modes/MapMode.tsx` | New file |
| `frontend/src/components/shared/TaskNode.tsx` | New file |
| `frontend/src/styles/map.css` | New file |
| `frontend/src/App.tsx` | Add `"map"` to MODES + Mode type |
| `frontend/src/components/modes/TodayMode.tsx` | Use unblocked task for "one thing" |
| `frontend/package.json` | Add `@xyflow/react` |

---

## Open questions before building

1. **Cross-day edges** — should a task from yesterday be allowed to block today's task? Initial answer: yes, but the edge is only shown in Map if the source task is also visible (i.e. carried over).

2. **Cycle detection** — if A blocks B and B blocks A, that's a deadlock. The backend should reject cycle-creating edges with a 409. Client-side: show a brief inline error on the edge handle ("creates a cycle").

3. **React Flow license** — `@xyflow/react` is MIT for non-commercial use and has a pro tier for commercial. Since this is a personal productivity tool, MIT applies. Confirm before shipping.

4. **Node layout persistence** — `localStorage` is simplest. If the user clears storage, positions reset to auto-layout. An alternative is a `task_positions` table in SQLite, but that's overkill for v1.
