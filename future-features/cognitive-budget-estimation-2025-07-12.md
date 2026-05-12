# ⏱ Cognitive Budget Estimation

> **Status**: Implemented  
> **Date**: 2025-07-12  
> **Layers**: Backend engine + Store + API + Frontend component

## Overview

Before starting a task, the system estimates its cognitive cost and time. If the estimate exceeds a 90-minute focus block, it automatically proposes splitting the task into smaller, accomplishable sub-tasks.

**User sees**: "This task is going to take X amount of time — splitting into multiple tasks to make sure it can be accomplished."

## Architecture

```
Task Text → Gather Project Context → Score Complexity Matrix → Estimate Time
                                            ↓
                                   [LLM or Heuristic]
                                            ↓
                              Should Split? → Suggest Sub-Tasks
                                            ↓
                                    Display in UI
```

## Complexity Matrix (7 Dimensions)

Each dimension is scored 1-10:

| Dimension | What it measures | Weight |
|-----------|-----------------|--------|
| **Scope** | How many files/systems does this touch? | 1.5× |
| **Novelty** | Is this familiar work or new territory? | 1.3× |
| **Dependencies** | How many external integrations? | 1.2× |
| **Ambiguity** | How well-defined is the task? (biggest driver) | 1.8× |
| **Prior Work** | How much relevant existing code/context exists? (inverse) | 1.0× |
| **Error Risk** | Likelihood of cascading errors? | 1.1× |
| **Cognitive Switch** | Context-switching between domains? | 1.4× |

## Estimation Modes

### 1. Heuristic Mode (no API key required)

Uses keyword analysis of the task text + project context to score each matrix dimension:

- **Scope keywords**: "refactor" → 8, "create" → 5, "fix" → 2
- **Ambiguity**: Short task descriptions (≤3 words) → high ambiguity (8)
- **Dependencies**: "integrate", "api", "oauth" → 7
- **Cognitive switch**: "frontend and backend", "full-stack" → 8
- **Confidence**: Capped at 75% (heuristic can never be fully confident)

### 2. LLM Mode (with ANTHROPIC_API_KEY)

Sends a parameterized context bundle to Claude:

```json
{
  "task_text": "Implement OAuth2 login flow",
  "project": {
    "name": "cognitive-offload",
    "directory_scan": "45 dirs, 180 files, .tsx:42, .go:28, .ts:15",
    "has_prior_work": true
  },
  "current_state": {
    "tasks_today": 5,
    "completed_today": 2,
    "open_sessions": 1,
    "historical_avg_min": 45
  },
  "recent_patterns": [...],
  "estimation_config": {
    "max_minutes_before_split": 90,
    "focus_block_minutes": 90,
    "weight_scope": 1.5,
    ...
  }
}
```

The LLM returns structured JSON with the same matrix + time estimate + split suggestions.

## Auto-Split Logic

When `estimated_min > 90` (configurable via `MaxMinutesBeforeSplit`):

- Calculates number of parts: `ceil(total / 90)`, capped at 5
- Generates sub-tasks with progressive prefixes:
  1. "Research and plan: ..."
  2. "Implement core: ..."
  3. "Wire up and integrate: ..."
  4. "Test and verify: ..."
  5. "Polish and finalize: ..."
- LLM mode generates context-aware splits instead

## Context Gathering

The estimator gathers:

1. **Today's tasks** — completion rate affects estimate
2. **Open LLM sessions** — cognitive load penalty (10% per session over 2)
3. **Recent patterns** — last 3 days of behavioral patterns
4. **Historical focus durations** — calibrates estimates to your personal pace
5. **Project directory scan** — file count, language distribution, structure

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/tasks/{id}/estimate` | Estimate an existing task |
| `POST` | `/api/v1/estimate` | Estimate a task description before creating |

### Request (POST /api/v1/estimate)
```json
{
  "task_text": "Refactor the authentication module to use JWT tokens",
  "project_path": "/path/to/project"
}
```

### Response
```json
{
  "id": "est-1720800000000",
  "task_id": "",
  "task_text": "Refactor the authentication module to use JWT tokens",
  "estimated_min": 135,
  "complexity": "high",
  "cognitive_load": 72,
  "confidence": 55,
  "should_split": true,
  "suggested_splits": [
    { "text": "Research and plan: Refactor the authentication module", "kind": "must", "estimated_min": 67, "order": 1 },
    { "text": "Implement core: Refactor the authentication module", "kind": "must", "estimated_min": 67, "order": 2 }
  ],
  "reasoning": "Heuristic estimate based on task text analysis. Key drivers: scope=8, ambiguity=5, novelty=4.",
  "matrix": {
    "scope": 8,
    "novelty": 4,
    "dependencies": 7,
    "ambiguity": 5,
    "prior_work": 7,
    "error_risk": 7,
    "cognitive_switch": 2
  },
  "source": "heuristic",
  "created_at": "2025-07-12T10:00:00Z"
}
```

## UI Integration

### TodayMode
- **Per-task ⏱ button** — Click to estimate any task's cognitive budget
- **Estimate before create** — "⏱ Estimate" button appears when typing a new task
- **Split apply** — One click creates all sub-tasks and removes the original

### CognitiveBudget Component
- Prominent time estimate (28px font)
- Complexity badge with color coding (green → amber → red)
- Cognitive load progress bar
- Collapsible 7-dimension complexity matrix with visual bars
- Split warning panel with ordered sub-tasks
- Source badge (AI vs heuristic)
- Re-estimate button

## Data Model

```sql
CREATE TABLE IF NOT EXISTS task_estimates (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL DEFAULT '',
    task_text     TEXT NOT NULL,
    estimated_min INTEGER NOT NULL DEFAULT 0,
    complexity    TEXT NOT NULL DEFAULT 'medium',
    cognitive_load INTEGER NOT NULL DEFAULT 0,
    confidence    INTEGER NOT NULL DEFAULT 0,
    should_split  INTEGER NOT NULL DEFAULT 0,
    splits_json   TEXT NOT NULL DEFAULT '[]',
    reasoning     TEXT NOT NULL DEFAULT '',
    matrix_json   TEXT NOT NULL DEFAULT '{}',
    source        TEXT NOT NULL DEFAULT 'heuristic',
    created_at    INTEGER NOT NULL
);
```

## Files Changed

### Backend
- `backend/internal/models/models.go` — Added `TaskEstimate`, `SuggestedTask`, `ComplexityMatrix`, `EstimateRequest`
- `backend/internal/engine/estimator.go` — **New** — Core estimation engine (600 lines)
- `backend/internal/store/store.go` — Added `task_estimates` table + `InsertTaskEstimate`, `TaskEstimatesByDay`, `LatestEstimateForTask`
- `backend/internal/api/router.go` — Added `POST /tasks/{id}/estimate` + `POST /estimate` endpoints

### Frontend
- `frontend/src/types/index.ts` — Added `ComplexityMatrix`, `SuggestedTask`, `TaskEstimate`
- `frontend/src/api/client.ts` — Added `estimateTask()`, `estimateNewTask()`
- `frontend/src/components/shared/CognitiveBudget.tsx` — **New** — Full estimation UI
- `frontend/src/components/shared/SortableTaskItem.tsx` — Added ⏱ estimate button
- `frontend/src/components/modes/TodayMode.tsx` — Integrated estimation flow + split apply

## Key Principles

1. **Non-blocking** — Estimation is optional, not a gate
2. **Two modes** — Works without API key (heuristic), better with one (LLM)
3. **Parameterized** — All weights are configurable, not hardcoded
4. **Context-aware** — Uses project directory, prior work, and current cognitive state
5. **Actionable** — Split suggestions are one-click to apply
6. **Persisted** — Estimates are stored for historical calibration
