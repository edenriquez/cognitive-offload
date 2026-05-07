# 🔀 Parallel Tasks — Cognitive Buffer Estimation for Multi-Tasking

> Status: Design  
> Date: 2025-06-07  
> Depends on: Phase 7 (Real-Time Signals), Phase 8 (LLM Session Tracking)

---

## Philosophy

Cogload does NOT manage your parallel work. You do.

Cogload's job is to **observe**, **measure**, and **inform**:
- How much cognitive buffer do you have right now?
- How many parallel tasks can you sustain before performance degrades?
- Where is the degradation line based on YOUR personal data?
- What is the actual measured cost of each context switch?

No limits. No caps. No blocking. No "buffer slots."  
You're the one working. Cogload just gives you the numbers.

---

## What Cogload Calculates

### 1. Cognitive Buffer

Your **cognitive buffer** is the spare processing capacity you have at any moment.  
It's not a fixed number — it shifts based on:

| Factor | Effect on buffer |
|--------|-----------------|
| Time of day | Buffer shrinks as day progresses |
| Current task complexity | Deep work = low buffer, admin = high buffer |
| Error rate trend | Rising errors = shrinking buffer |
| LLM wait states | Agent working = temporary buffer spike |
| Active parallel tasks | Each task consumes buffer |
| Time since last recovery | Longer without break = less buffer |
| Recent switch frequency | More switches = faster buffer drain |

**Formula:**

```
buffer = base_capacity 
       - (active_tasks × per_task_cost)
       - (error_rate_delta × error_weight)
       - (hours_since_break × fatigue_factor)
       - (switches_last_hour × switch_cost)
       + (llm_wait_bonus if agent is working)
       + (recovery_bonus if recent break)
```

Where `base_capacity`, `per_task_cost`, and all weights are **learned from your personal data** 
over time. Everyone's numbers are different.

**Output:** A 0–100 score. Higher = more spare capacity.

```
Buffer: 72  ████████████████████░░░░░  — Room to take on more
Buffer: 41  ████████████░░░░░░░░░░░░░  — Getting loaded
Buffer: 18  █████░░░░░░░░░░░░░░░░░░░░  — Near capacity
Buffer:  5  █░░░░░░░░░░░░░░░░░░░░░░░░  — Performance degradation likely
```

### 2. Estimated Parallel Capacity

Based on your current buffer and historical data, cogload estimates:

> "At your current state, you can handle **~3 parallel tasks** before 
> performance degradation begins."

This is a **prediction**, not a limit. It answers:  
*"If I pick up another task right now, will my output quality drop?"*

The estimate comes from correlating your past parallel work sessions with 
measured outcomes (error rates, recovery times, completion rates).

### 3. Performance Degradation Probability

For each additional task you take on:

```
Current: 2 parallel tasks
  +1 task → 15% chance of performance degradation
  +2 tasks → 62% chance of performance degradation  
  +3 tasks → 89% chance of performance degradation
```

Based on your historical data at this time of day, with this activity level, 
at this error rate.

---

## What Cogload Observes

### Parallel Task Detection

Cogload doesn't need you to "start a parallel session." It **observes** your work:

| Signal | Interpretation |
|--------|---------------|
| Focus mode active on Task A | Primary task |
| File saves in a different project directory | Working on something else |
| LLM session starts for a different topic | New thread opened |
| Git branch switch | Context changed |
| File saves resume in original directory | Switched back |

From these signals, cogload reconstructs:
- How many tasks you're juggling
- How long you spend on each before switching
- When you switch and what triggered it
- How long it takes you to re-engage after switching back

### Context Switch Detection

Every time you switch between tasks, cogload records:

| Data point | How it's measured |
|------------|-------------------|
| Switch timestamp | File activity in new directory / new LLM session |
| Recovery time | Seconds until first meaningful action after switch |
| Error rate before | Errors in 5 min window before switch |
| Error rate after | Errors in 5 min window after switch |
| Activity drop | Activity density change in first 2 min after switch |
| Attention residue | File activity in OLD task's directory after switching away |

---

## Metrics

### A. Performance Metrics — Is parallel work productive?

| Metric | What it measures | How |
|--------|-----------------|-----|
| **Net Throughput Delta** | Does parallel work increase or decrease your total output? | Compare tasks-completed/hour on parallel days vs single-task days |
| **LLM Wait Reclaim** | How much idle LLM-wait time becomes productive? | `productive_minutes_during_llm_wait / total_llm_wait_minutes` |
| **Completion Rate** | Are parallel tasks actually finishing or just starting? | `completed / started` for tasks worked in parallel |
| **Switch Overhead** | Total time lost to context switching per day | `Σ(recovery_time_per_switch)` |
| **Effective Parallel Time** | Productive buffer time minus switch costs | `parallel_productive_min - switch_overhead_min` |

### B. Cognitive Degradation Metrics — Is parallel work hurting you?

#### B1. Context Switch Cost (CSC)

The measured time and quality cost of each individual switch.

```
Switch #1:  recovery 28s, error delta +0.02  — clean
Switch #2:  recovery 35s, error delta +0.05  — clean
Switch #3:  recovery 52s, error delta +0.11  — cost rising
Switch #4:  recovery 88s, error delta +0.23  — degradation
Switch #5:  recovery 140s, error delta +0.41 — significant degradation
```

**Key insight:** Switches don't have constant cost. They compound.  
The 5th switch costs 5× the 1st. Cogload measures this curve for YOU specifically.

#### B2. Recovery Debt

Accumulated switching cost that compounds through the day.

```
Recovery Debt = Σ(recovery_sec[i] × compound_factor[i])

Compound factors: 1.0, 1.0, 1.1, 1.3, 1.6, 2.0, 2.5, 3.2 ...
```

Early switches are cheap. Late switches are expensive.  
The compound factor is calibrated from your personal data.

**What it answers:** "I've switched 6 times today. Is the next switch still worth it?"

#### B3. Error Rate Acceleration (ERA)

How fast your error rate climbs compared to single-task days.

```
ERA = slope(error_rate) on parallel days / slope(error_rate) on single-task days
```

| ERA | Meaning |
|-----|---------|
| 0.8–1.2 | No significant difference — parallel work isn't hurting quality |
| 1.2–1.8 | Moderate acceleration — quality degrades faster on parallel days |
| 1.8+ | Strong acceleration — parallel work is significantly hurting quality |

#### B4. Attention Residue

After switching from Task A to Task B, how much of your brain stays on Task A.

**Measured via:**
- File saves in Task A's directory AFTER you switched to Task B
- LLM prompts mentioning Task A's context after switching
- Longer-than-baseline pause before first action on Task B

```
Attention Residue: 0.8 min avg  — clean switcher
Attention Residue: 3.2 min avg  — significant bleed
Attention Residue: 6.0 min avg  — you're not really switching, you're splitting
```

#### B5. Cognitive Decay Rate (CDR)

The speed at which your overall cognitive performance degrades through the day.
Computed every 30 minutes from:

```
CDR = weighted combination of:
  - Error rate trend          (30%)
  - Recovery time trend       (25%)
  - Activity density trend    (20%)
  - Switch cost trend         (15%)
  - Thread closure rate       (10%)
```

CDR is computed daily and compared across:
- Days with 0 parallel tasks (baseline)
- Days with 1–2 parallel tasks
- Days with 3+ parallel tasks

This produces YOUR personal degradation model:

```
Your data (last 30 days):
  0 parallel tasks: CDR reaches 50% at 15:30 avg
  1-2 parallel:     CDR reaches 50% at 14:45 avg  (45 min earlier)
  3+ parallel:      CDR reaches 50% at 13:20 avg  (2h 10m earlier)
  
Translation: Each parallel task costs you ~40 min of peak performance.
```

#### B6. Degradation Onset Point

The moment performance starts measurably declining.  
Derived from the first inflection point in the CDR curve.

```
Today's degradation onset:
  Predicted: 14:20 (based on current load + your history)
  Actual:    — (not yet reached)
  
  If you add another task now: predicted onset shifts to 13:45
```

This is the most actionable metric. It directly answers:  
*"How much runway do I have left?"*

---

## Data Model

### New: `parallel_sessions` table

Tracks observed parallel work periods (auto-detected, not user-declared).

```sql
CREATE TABLE IF NOT EXISTS parallel_sessions (
    id            TEXT PRIMARY KEY,
    day           TEXT NOT NULL,
    
    -- What's being juggled
    task_ids      TEXT NOT NULL DEFAULT '[]',  -- JSON array of task IDs
    peak_parallel INTEGER NOT NULL DEFAULT 1,  -- Max concurrent tasks observed
    
    -- Timing
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    
    -- Computed metrics
    buffer_at_start    INTEGER,  -- Cognitive buffer score when parallel work began
    buffer_at_end      INTEGER,  -- Cognitive buffer score when it ended
    total_switches     INTEGER DEFAULT 0,
    avg_recovery_sec   REAL DEFAULT 0,
    net_throughput      REAL DEFAULT 0,  -- Tasks completed / hour during this session
    degradation_detected INTEGER DEFAULT 0  -- 1 if performance degradation was observed
);
CREATE INDEX IF NOT EXISTS idx_parallel_day ON parallel_sessions(day);
```

### New: `context_switches` table

Every observed task switch.

```sql
CREATE TABLE IF NOT EXISTS context_switches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    day           TEXT NOT NULL,
    session_id    TEXT,  -- Links to parallel_sessions if active
    
    -- Switch details  
    from_task_id  TEXT NOT NULL,
    to_task_id    TEXT NOT NULL,
    switched_at   INTEGER NOT NULL,
    trigger       TEXT NOT NULL,  -- 'file_activity' | 'llm_session' | 'git_branch' | 'manual'
    
    -- Post-switch measurements (filled in async after the switch)
    recovery_sec          INTEGER,
    error_rate_before     REAL,
    error_rate_after      REAL,
    activity_drop_pct     REAL,
    attention_residue_sec INTEGER
);
CREATE INDEX IF NOT EXISTS idx_switches_day ON context_switches(day);
```

### New: `cognitive_buffer_log` table

Continuous buffer score tracking (every 10 min, aligned with buckets).

```sql
CREATE TABLE IF NOT EXISTS cognitive_buffer_log (
    day        TEXT NOT NULL,
    bucket_idx INTEGER NOT NULL,
    
    buffer_score       INTEGER NOT NULL,  -- 0-100
    active_tasks       INTEGER NOT NULL,
    estimated_capacity INTEGER NOT NULL,  -- Predicted max tasks before degradation
    degradation_prob   REAL NOT NULL,     -- 0.0-1.0 probability at current load
    
    -- Components (for debugging/review)
    fatigue_component  REAL,
    error_component    REAL,
    switch_component   REAL,
    load_component     REAL,
    
    PRIMARY KEY (day, bucket_idx)
);
```

### New: `degradation_baselines` table

Your personal performance model, updated weekly.

```sql
CREATE TABLE IF NOT EXISTS degradation_baselines (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    computed_at     INTEGER NOT NULL,
    days_sampled    INTEGER NOT NULL,
    
    -- Baseline metrics (single-task days)
    baseline_cdr_slope        REAL,  -- How fast CDR rises on single-task days
    baseline_error_slope      REAL,  -- Error rate slope on single-task days
    baseline_degradation_hour REAL,  -- When degradation typically starts
    
    -- Per-task-count averages
    avg_switch_cost_1_task    REAL,  -- Avg recovery sec with 1 parallel task
    avg_switch_cost_2_tasks   REAL,
    avg_switch_cost_3_tasks   REAL,
    avg_switch_cost_4plus     REAL,
    
    -- Compound factor (how much each additional switch costs more)
    switch_compound_factor    REAL,  -- e.g., 1.3 means each switch costs 1.3× more
    
    -- Capacity estimate
    avg_capacity_morning      INTEGER,  -- Parallel task capacity 09:00-12:00
    avg_capacity_afternoon    INTEGER,  -- Parallel task capacity 13:00-17:00
    
    -- JSON blob of full model parameters
    model_params TEXT NOT NULL DEFAULT '{}'
);
```

---

## Representation

### Signal Strip — Buffer Score

The cognitive buffer score lives in the signal strip alongside existing signals:

```
Focus: stable · Threads: 2 · Buffer: 64 · Errors: 0.3× · CDR: 28 · Cutoff: 3h
                              ↑                           ↑
                        Spare capacity              Decay rate
```

Buffer score color coding (informational only):
- **72–100**: High buffer (green dot) — plenty of spare capacity
- **40–71**: Moderate buffer (yellow dot) — can handle more, but watch trends
- **15–39**: Low buffer (orange dot) — performance degradation becoming likely
- **0–14**: Near zero (red dot) — performance is likely degraded

### Focus Mode — Parallel Info Panel

When cogload detects you're working on multiple things, Focus mode shows:

```
┌─────────────────────────────────────────────────┐
│  FOCUS · Implement auth system            47:23  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░░░ │
│                                                  │
│  ┌─ PARALLEL WORK ─────────────────────────────┐ │
│  │  3 tasks active                             │ │
│  │                                             │ │
│  │  🎯 Implement auth system       32 min      │ │
│  │  ○  Fix CI pipeline              8 min      │ │
│  │  ○  Update API docs              3 min      │ │
│  │                                             │ │
│  │  Buffer: 48 · Est. capacity: ~3 tasks       │ │
│  │  Switches today: 7 · Avg recovery: 38s      │ │
│  │  Degradation onset: ~14:20                  │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

No enforcement. Just information. The user sees their buffer, their switch costs, 
and the predicted degradation onset. They decide what to do.

### Today Mode — Parallel Summary Card

When parallel work is detected, Today mode shows a summary card:

```
┌─ PARALLEL WORK ──────────────────────────────────┐
│                                                   │
│  Active now: 3 tasks                              │
│  Buffer: 48/100     ████████████░░░░░░░░░░░░░    │
│  Est. capacity: ~3 tasks at current state         │
│                                                   │
│  +1 task → 22% degradation risk                   │
│  +2 tasks → 67% degradation risk                  │
│                                                   │
│  Switch cost today: 4.2 min total (7 switches)    │
│  LLM wait reclaimed: 12 min                       │
│                                                   │
└───────────────────────────────────────────────────┘
```

### Review Mode — Parallel Analysis Section

End-of-day review includes a parallel work analysis:

```
PARALLEL WORK
━━━━━━━━━━━━━

Peak parallel tasks: 4 (at 11:15)
Total context switches: 12
Total switch overhead: 8.3 min
LLM wait time reclaimed: 18 min
Net gain: +9.7 min

Switch Cost Curve:
  #1   32s ·
  #2   35s ·
  #3   41s ··
  #4   52s ···
  #5   68s ····
  #6   89s ·····        ← cost compounding
  #7  105s ······
  ...

Degradation Analysis:
  Onset: 14:05 (45 min earlier than single-task baseline)
  Your parallel cost: ~40 min peak performance per extra task
  
  Days 0 parallel:   degradation at 15:30 avg
  Days 1-2 parallel: degradation at 14:50 avg  
  Days 3+ parallel:  degradation at 13:30 avg

  Today: 3+ parallel → degradation at 14:05 (within expected range)

Attention Residue:
  Avg residue: 1.8 min per switch
  Worst: 4.2 min (switch #6, CI → auth)
  Clean switches: 8/12 (67%)
```

### Tomorrow Mode — Parallel Budget

Tomorrow plan can include parallel work observations:

```
PARALLEL WORK NOTES
  Yesterday: 3+ parallel tasks, degradation at 14:05
  Trend: degradation onset shifting 15 min earlier this week
  
  If you plan parallel work tomorrow:
    Morning capacity: ~4 tasks (buffer high)
    Afternoon capacity: ~2 tasks (buffer drops)
    Est. switch cost: 6-8 min total
```

### Cognitive Buffer Timeline (Review)

A time-series visualization showing buffer throughout the day:

```
Buffer
100│ ████                                    
   │ ████████                                
 75│ ██████████                              
   │ ████████████                            
 50│ ██████████████████                      
   │ ████████████████████                    
 25│ ████████████████████████████            
   │ ████████████████████████████████        
  0│ ██████████████████████████████████████  
   └──┬─────┬─────┬─────┬─────┬─────┬──    
    09:00 10:00 11:00 12:00 13:00 14:00     

   ▼ 10:15  Started parallel (2 tasks)
   ▼ 11:00  Added 3rd task — buffer dropped 15pts
   ▼ 13:00  Post-lunch dip + 3 tasks = rapid drain
   ▼ 14:05  Performance degradation detected
```

---

## Computation: How Buffer Score Works

### Input Signals (real-time, every 10 min)

```go
type BufferInputs struct {
    HourOfDay          float64  // 0-24
    ActiveTasks        int      // Currently juggled tasks
    ErrorRateDelta     float64  // Error rate change vs morning baseline
    SwitchesLastHour   int      // Context switches in last 60 min
    AvgRecoverySec     float64  // Average recovery time for recent switches
    MinSinceBreak      int      // Minutes since last idle/break period
    LLMWaiting         bool     // Is an LLM agent currently working?
    ActivityDensity    int      // Current bucket activity (0-100)
    OpenLoops          int      // Unclosed threads/tasks
}
```

### Buffer Computation

```go
func ComputeBuffer(inputs BufferInputs, baseline PersonalBaseline) int {
    // Start from base capacity (time-of-day adjusted)
    base := baseline.BaseCapacity(inputs.HourOfDay)  // e.g., 85 at 09:00, 60 at 15:00
    
    // Subtract per-task cost (learned from personal data)
    taskCost := float64(inputs.ActiveTasks) * baseline.PerTaskCost  // e.g., 12 per task
    
    // Subtract error-rate impact
    errorCost := inputs.ErrorRateDelta * baseline.ErrorWeight  // e.g., ×15
    
    // Subtract fatigue from lack of recovery
    fatigueCost := float64(inputs.MinSinceBreak) / 60.0 * baseline.FatigueFactor  // e.g., 5 per hour
    
    // Subtract switch cost accumulation
    switchCost := float64(inputs.SwitchesLastHour) * baseline.SwitchWeight  // e.g., 3 per switch
    
    // Add LLM wait bonus (temporary buffer from idle wait)
    llmBonus := 0.0
    if inputs.LLMWaiting {
        llmBonus = baseline.LLMWaitBonus  // e.g., +15
    }
    
    score := base - taskCost - errorCost - fatigueCost - switchCost + llmBonus
    return clamp(int(score), 0, 100)
}
```

### Estimated Capacity

```go
func EstimateCapacity(currentBuffer int, baseline PersonalBaseline) int {
    // How many more tasks before buffer hits degradation zone?
    // Degradation zone = buffer < baseline.DegradationThreshold (e.g., 20)
    remaining := float64(currentBuffer) - float64(baseline.DegradationThreshold)
    if remaining <= 0 {
        return 0
    }
    return int(remaining / baseline.PerTaskCost)
}
```

### Degradation Probability

```go
func DegradationProbability(currentBuffer int, additionalTasks int, baseline PersonalBaseline) float64 {
    projectedBuffer := currentBuffer - (additionalTasks * int(baseline.PerTaskCost))
    if projectedBuffer >= baseline.SafeZone {
        return 0.05  // Very unlikely
    }
    if projectedBuffer <= 0 {
        return 0.95  // Almost certain
    }
    // Sigmoid curve between safe zone and zero
    midpoint := float64(baseline.DegradationThreshold)
    steepness := 0.15  // Learned from personal data
    return 1.0 / (1.0 + math.Exp(steepness * (float64(projectedBuffer) - midpoint)))
}
```

### Personal Baseline Learning

After 7+ days of data, cogload computes personal baselines:

```go
type PersonalBaseline struct {
    BaseCapacity         func(hour float64) float64  // Time-of-day curve
    PerTaskCost          float64   // Buffer cost per parallel task (learned)
    ErrorWeight          float64   // How much error rate impacts buffer
    FatigueFactor        float64   // How fast fatigue drains buffer
    SwitchWeight         float64   // Per-switch buffer drain
    LLMWaitBonus         float64   // Buffer recovery during LLM waits
    DegradationThreshold int       // Buffer level where degradation starts
    SafeZone             int       // Buffer level where you're definitely fine
    SwitchCompound       float64   // How much each switch costs more than the last
}
```

Learned by correlating:
- Days with parallel work vs days without
- Error rates at different buffer levels
- Recovery times at different switch counts
- The point where task completion rate starts dropping

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/parallel/buffer` | Current cognitive buffer score + estimated capacity |
| `GET` | `/api/v1/parallel/active` | Currently detected parallel tasks |
| `GET` | `/api/v1/parallel/switches` | Today's context switch log |
| `GET` | `/api/v1/parallel/metrics` | Today's parallel work metrics summary |
| `GET` | `/api/v1/parallel/history?day=` | Parallel sessions for a given day |
| `GET` | `/api/v1/parallel/baseline` | Your personal degradation baseline |
| `GET` | `/api/v1/parallel/degradation` | Predicted degradation onset for today |

All read-only. Cogload observes — it doesn't manage parallel lifecycle.

---

## WebSocket Signal Enhancement

The `SignalSnapshot` pushed via WebSocket every 5s gains new fields:

```go
type SignalSnapshot struct {
    // ... existing fields ...
    
    // Parallel work signals
    CognitiveBuffer      int     `json:"cognitive_buffer"`       // 0-100
    ActiveParallelTasks  int     `json:"active_parallel_tasks"`  // Currently detected
    EstimatedCapacity    int     `json:"estimated_capacity"`     // Tasks before degradation
    SwitchesToday        int     `json:"switches_today"`         // Total switches
    AvgRecoverySec       float64 `json:"avg_recovery_sec"`       // Mean recovery time
    DegradationOnset     string  `json:"degradation_onset"`      // Predicted time, e.g. "14:20"
    DegradationProbNext  float64 `json:"degradation_prob_next"`  // Prob if +1 task added
}
```

---

## Integration with Existing Systems

### Engine Rules (Informational, not blocking)

The existing enforcement engine gains informational rules:

```go
// Performance degradation detected (info, not block)
if bufferScore < 15 && activeParallelTasks > 1 {
    Severity: "info"
    "Performance degradation likely at current load."
    "Buffer: {score}/100 · Parallel tasks: {count}"
}

// Switch cost compounding (info)  
if currentRecovery > 2 * firstRecovery {
    Severity: "info"
    "Switch cost compounding — recovery time has doubled since first switch."
}
```

These are `info` severity — they show in the signal strip but never block.

### Pattern Detection

The pattern detector recognizes parallel work patterns:

```go
// Kind: "perf-degradation" (replaces old "thrashing")
// Now has richer context about whether degradation was from 
// parallel work overload vs reactive switching

// Kind: "parallel-productive"
// Detected when parallel work sessions had positive net throughput

// Kind: "parallel-diminishing"  
// Detected when parallel work showed diminishing returns 
// (e.g., 4th task onwards had negative ROI)
```

### Review Integration

The daily review computes parallel-specific summaries:

```go
type ParallelReview struct {
    PeakParallelTasks    int      // Max concurrent observed
    TotalSwitches        int      // Context switches
    TotalSwitchOverhead  float64  // Minutes lost to recovery
    LLMWaitReclaimed     float64  // Minutes of productive work during LLM waits
    NetGain              float64  // LLM reclaimed - switch overhead
    DegradationOnset     string   // When degradation was first detected
    BaselineDegradation  string   // When degradation starts on single-task days
    DegradationDelta     float64  // How much earlier degradation hit
    SwitchCostCurve      []float64 // Recovery time per switch (shows compounding)
    AttentionResidueAvg  float64  // Average residue time per switch
    BufferCurve          []int    // Buffer score timeline
}
```

### Tomorrow Plan Integration

The planner factors in parallel work patterns:

```go
// If degradation onset has been shifting earlier this week,
// the plan notes it:
"Parallel work shifting degradation 15 min earlier per day this week."

// Bandwidth includes parallel work estimate:
"Morning capacity: ~4 parallel tasks"
"Afternoon capacity: ~2 parallel tasks"
```

---

## Implementation Plan

### Phase A — Observation Layer (4 days)

| # | What | Where |
|---|------|-------|
| A.1 | `context_switches` table + migration | `store.go` |
| A.2 | `parallel_sessions` table + migration | `store.go` |
| A.3 | `cognitive_buffer_log` table + migration | `store.go` |
| A.4 | Context switch detection from file activity patterns | `engine/parallel.go` |
| A.5 | Context switch detection from LLM session changes | `engine/parallel.go` |
| A.6 | Context switch detection from git branch switches | `engine/parallel.go` |
| A.7 | Recovery time measurement (time to first action after switch) | `engine/parallel.go` |
| A.8 | Attention residue detection (activity in old task after switch) | `engine/parallel.go` |

### Phase B — Buffer Computation (3 days)

| # | What | Where |
|---|------|-------|
| B.1 | Default buffer model (before personal data exists) | `engine/parallel.go` |
| B.2 | Real-time buffer computation every 10 min | `engine/parallel.go` |
| B.3 | Estimated capacity calculation | `engine/parallel.go` |
| B.4 | Degradation probability curve | `engine/parallel.go` |
| B.5 | Degradation onset prediction | `engine/parallel.go` |
| B.6 | Buffer score in `SignalSnapshot` via WebSocket | `engine.go` |
| B.7 | Log buffer to `cognitive_buffer_log` every bucket | `engine/parallel.go` |

### Phase C — Personal Baseline Learning (4 days)

| # | What | Where |
|---|------|-------|
| C.1 | `degradation_baselines` table + migration | `store.go` |
| C.2 | Weekly baseline recomputation from historical data | `engine/parallel.go` |
| C.3 | Per-task-cost calibration from parallel sessions | `engine/parallel.go` |
| C.4 | Switch compound factor learning | `engine/parallel.go` |
| C.5 | Time-of-day capacity curve fitting | `engine/parallel.go` |
| C.6 | Degradation threshold calibration | `engine/parallel.go` |

### Phase D — API + Review (3 days)

| # | What | Where |
|---|------|-------|
| D.1 | All `/api/v1/parallel/*` read endpoints | `router.go` |
| D.2 | Parallel review section in `/api/v1/review/:day` | `router.go` |
| D.3 | Parallel notes in `/api/v1/tomorrow` plan generation | `planner.go` |
| D.4 | Pattern: "perf-degradation" with parallel context | `patterns.go` |
| D.5 | Pattern: "parallel-productive" / "parallel-diminishing" | `patterns.go` |

### Phase E — Frontend (5 days)

| # | What | Where |
|---|------|-------|
| E.1 | Buffer score in signal strip | `App.tsx` |
| E.2 | Parallel info panel in Focus mode | `FocusMode.tsx` |
| E.3 | Parallel summary card in Today mode | `TodayMode.tsx` |
| E.4 | Parallel analysis section in Review mode | `ReviewMode.tsx` |
| E.5 | Cognitive buffer timeline chart | New `BufferTimeline.tsx` |
| E.6 | Switch cost curve chart | New `SwitchCostChart.tsx` |
| E.7 | Degradation onset indicator | New `DegradationIndicator.tsx` |
| E.8 | Parallel notes in Tomorrow mode | `TomorrowMode.tsx` |
| E.9 | Buffer score + capacity in WebSocket signal handling | `ws-client.ts`, `app-store.ts` |

**Total: ~19 days across phases A-E**

---

## Self-Report: Subjective Ground Truth

**Implemented.** A swipeable edge panel on the right side of the screen lets the user 
report their subjective cognitive state at any time. This creates ground truth data 
that calibrates the objective buffer model.

### Interaction

- Thin handle tab on right edge with status dot (matches signal strip dot system)
- Swipe left to reveal, swipe right to hide, tap to toggle, click outside to collapse
- 5 levels with 6px indicator dots:
  - Fresh (green dot) · Focused (green dot) · Loaded (green dot) · Tired (yellow dot) · Degraded (red dot)
- Tap a level → recorded instantly, panel slides back
- Zero friction — can report in <2 seconds without leaving current work
- Visual language: monochrome panel, same dot/color system as signal strip, no emojis

### Data Collected

Each report stores:
- `level` (1-5)
- `label` (fresh/focused/loaded/tired/degraded) 
- `ts` (unix milliseconds)
- `bucket_idx` (which 10-min bucket this falls in)
- `note` (optional free text)

### Calibration Value

Self-reports are overlaid on the objective data in Review mode, creating pairs:

```
"At 14:30, buffer score was 32 and user reported 'tired' (level 4)"
"At 10:15, buffer score was 78 and user reported 'fresh' (level 1)"
```

Over time, these pairs calibrate:
- **DegradationThreshold** — at what buffer score does the user actually feel degraded?
- **PerTaskCost** — does the user feel the cost of each parallel task the same as the model predicts?
- **Personal sensitivity** — some people feel loaded at buffer 50, others at buffer 30

The self-report data makes the personal baseline model converge faster and more accurately 
than objective signals alone.

### Review Integration

Self-reported states appear as colored dots on a timeline in Review mode, 
aligned with the energy map so you can see:
- "I reported tired at 14:30 — buffer was 32, error rate was 1.8×"
- "I reported fresh at 10:00 — buffer was 81, 0 parallel tasks"

This correlation is the most valuable data the system collects.

---

## Key Principles

1. **Observe, don't control.** Cogload never blocks parallel work. Ever.
2. **Measure everything.** Every switch, every recovery, every error delta.
3. **Learn the individual.** Everyone's buffer capacity is different. Cogload learns yours.
4. **Inform with numbers.** "Buffer: 48, est. capacity: 3" — not "you're doing too much."
5. **Show the cost.** "Each switch costs you 52s recovery" — the user decides if it's worth it.
6. **Predict, don't prescribe.** "Degradation likely at 14:20" — not "stop working at 14:20."
7. **No moral judgment.** High parallel work isn't bad. It's a tradeoff. Cogload shows the tradeoff.
