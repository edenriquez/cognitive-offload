# Review Mode — Redesign Plan

> Status: Planned  
> Last updated: 2026-05-25

---

## The Problem With The Current Design

The current Review mode presents data as a **report** — something you read and move on from. It has sections like "Detected patterns", "Root causes", and "Where time leaked" that show correct information but ask nothing of the user and offer no path forward.

The specific problems:

**Patterns are diagnosis without prescription.**  
"5 sessions in 30 min — avg 3m. Likely context fragmentation." is true. But the user already knows they were fragmented. They want to know *what to do differently tomorrow*. The pattern card ends with a fact, not a decision.

**Root causes are guesses presented as conclusions.**  
A bar at "72% confidence" for "high AI interaction / low code output" feels authoritative but isn't actionable. The user can't dispute it or confirm it.

**The layout buries the high-signal items.**  
The energy map (which shows the actual rhythm of the day) is below the summary stats. Patterns come after that. Root causes come after patterns. The most important insight — *when did I stop being productive?* — requires scrolling to find.

**Nothing is interactive.**  
Reading a pattern and reading a suggestion is the same action: passive consumption. There's no moment where the user makes a decision that shapes tomorrow.

---

## The Core Insight: Reflect → Decide → Commit

A useful end-of-day review has three phases:

1. **Reflect** — What actually happened? (not what you think happened)
2. **Decide** — Given what happened, what do I change?
3. **Commit** — Write it down so tomorrow's plan is different

The current design only does phase 1, partially. Phases 2 and 3 don't exist.

The redesign makes all three explicit.

---

## New Structure

```
┌──────────────────────────────────────────────────────────┐
│  Header: "Today — {date}"  ·  Auto-generated from logs   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. THE ARC  ─────────────────────────────────────────── │
│     Timeline strip: energy, wall time, self-reports      │
│     Single sentence: "Your best 3h was 9–12. Wall at 3." │
│                                                          │
│  2. THREE NUMBERS  ──────────────────────────────────────│
│     Deep work · Leaked time · Session depth              │
│     Each with a week sparkline (trend, not just today)   │
│                                                          │
│  3. WHAT HAPPENED  ──────────────────────────────────────│
│     Collapsed cards, one per signal that fired:          │
│     Each card: what happened → why it matters → one      │
│     binary choice the user makes (Acknowledge / Dismiss) │
│                                                          │
│  4. ONE THING TO CHANGE  ────────────────────────────────│
│     Single auto-generated commitment the user can:       │
│     Accept → adds as a constraint to tomorrow's plan     │
│     Edit → opens inline text edit, then accept           │
│     Skip → dismissed for today                           │
│                                                          │
│  5. WRAP UP  ─────────────────────────────────────────── │
│     Open threads count with inline resolve               │
│     → Tomorrow button                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Section 1 — The Arc

**Replace:** Energy map + Self-report chart as separate sections  
**With:** A single unified timeline strip

The timeline shows the full day from 7am to now as one horizontal band:

```
7:00 ──────────────────────────────────────────── now
      [████▓▓▓░░░░░██████▓░░░░░░░░████████▓▓░░░░]
      9:00    11:00  12:00  14:00   16:00
              ☕ lunch  ↓ self-report: loaded   ⚡ wall
```

- Activity is shown as a bar chart compressed into one horizontal strip
- Self-report dots are overlaid on the strip at their exact timestamps
- The detected wall time (if any) is a vertical marker
- Hovering any region shows the bucket detail in a tooltip

Below the strip, one sentence generated from the data:

> "Your most productive window was 9:00–11:30. Activity dropped 60% after lunch. The e-bike wall arrived at 3:15 PM."

**Why this is better:** The energy map already exists and is good. The problem is it's buried. Making it the first thing — and compressing it into a single strip — makes the day's arc immediately legible without scrolling.

---

## Section 2 — Three Numbers

Three stats presented as large numbers with a 7-day sparkline below each:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  2h 40m      │  │  38m         │  │  4.2 msgs/    │
│  Deep work   │  │  Leaked time │  │  session avg  │
│  ▂▃▅▄▃▆▇     │  │  ▇▅▆▇▅▄▂     │  │  ▃▄▃▅▆▄▇     │
└──────────────┘  └──────────────┘  └──────────────┘
```

The sparkline comes from `GET /api/v1/trends?days=7`. It gives the stat meaning — a leaked time of 38 minutes is fine if it was 90 last week. Without the trend, the number is just a number.

**Replace:** Static `rs-cell` stats  
**With:** `InsightStat` component with sparkline + direction arrow (↑↓ vs yesterday)

---

## Section 3 — What Happened (Signal Cards)

**Replace:** "Detected patterns" list + "Root causes" list  
**With:** Signal cards — one per detected pattern, but redesigned

Each card has three layers that expand progressively:

```
┌─────────────────────────────────────────────── ▼ ┐
│  ⚡  Context fragmentation  ·  high              │  ← collapsed
│     5 sessions in 30 minutes (10:00–10:30)       │
└───────────────────────────────────────────────── ┘

Expanded:
┌─────────────────────────────────────────────── ▲ ┐
│  ⚡  Context fragmentation  ·  high              │
│     5 sessions in 30 minutes (10:00–10:30)       │
│                                                  │
│  What this means:                                │
│  You opened 5 AI threads in 30 minutes with an   │
│  average of 3 messages each. This is a sign of   │
│  thrashing — switching problems before solving   │
│  any of them. Output drops significantly.        │
│                                                  │
│  The actual cost:                                │
│  Each context switch costs ~8 minutes of         │
│  recovery time. 5 switches = ~40 minutes lost    │
│  even if you can't see it on the energy map.    │
│                                                  │
│  [ Acknowledge — I'll fix this ]  [ Dismiss ]   │
└─────────────────────────────────────────────── ┘
```

**"Acknowledge"** marks the pattern as acknowledged (persisted). It adds a lightweight commitment: "Max 2 concurrent threads" to tomorrow's constraint list.

**"Dismiss"** marks it as noise for today. Dismissed patterns don't surface again unless the severity increases.

The key change: **every pattern card ends with a binary action, not a fact.** The user cannot simply read and scroll — they must make a choice.

### Pattern → explanation → consequence map

The backend already has `kind`, `severity`, `title`, `detail`, `window`, `evidence`. The frontend adds a static explanation and consequence per pattern kind:

| Pattern kind | What this means | Actual cost |
|---|---|---|
| `perf-degradation` | You were thrashing — switching before solving | ~8min recovery per switch |
| `crash` | Post-lunch energy drop wasn't recovered | ~45min of low-output afternoon |
| `fatigue` | Working past cognitive cutoff with errors rising | Errors compound — tomorrow starts in debt |
| `stuck` | Long thread with few messages — spinning wheels | Time sunk without output |
| `open-loops` | Unresolved threads create cognitive residue | Each loop costs ~4% working memory |

These are **static copy** — they don't depend on real data. They're written once and matched to pattern kind. This is honest: we don't know the exact cost, but we can give a calibrated estimate that helps the user understand *why it matters*.

---

## Section 4 — One Thing To Change

**Replace:** The suggestion list (3 items)  
**With:** A single, editable commitment

The system selects the highest-priority suggestion and presents it as a full-width commitment card:

```
┌──────────────────────────────────────────────────────┐
│  Tomorrow, commit to:                                 │
│                                                       │
│  "Stop opening new threads after 3:00 PM."           │
│                                  ✎ edit               │
│                                                       │
│  Why: Your wall hit at 3:15 PM today. New sessions   │
│  after that point produced zero file saves.          │
│                                                       │
│  [ Add to tomorrow's plan ]        [ Not today ]     │
└──────────────────────────────────────────────────────┘
```

**"Add to tomorrow's plan"** — calls `PUT /api/v1/tomorrow` to add a constraint with `locked: false`. The user will see it in the Tomorrow tab.

**"Not today"** — dismisses. The suggestion is still visible as a secondary suggestion below the card, just smaller.

**Edit mode** — clicking the pencil or the text turns it into an inline input. The user can rewrite the commitment in their own words. This matters: a commitment the user wrote is one they own.

**Why one instead of three:** Three suggestions creates a menu problem. The user reads all three, feels overwhelmed, and acts on none. One suggestion forces a binary decision: yes or no. The cognitive cost of deciding drops to near zero.

---

## Section 5 — Wrap Up

**Simplified from current:**  
Instead of a full sessions table, just:

```
┌──────────────────────────────────────────────────────┐
│  3 threads still open                                 │
│  "Debug auth flow" · "Refactor tokens" · +1 more     │
│                           [ Resolve all ]  [ Review ] │
└──────────────────────────────────────────────────────┘
```

The "Review" link navigates to the Threads tab. "Resolve all" closes them in one call.

---

## What's Removed

| Removed | Reason |
|---|---|
| "Root causes" section | Guesses at 65–72% confidence dressed as conclusions. Adds no actionable value. |
| "Where time leaked" section | Replaced by the Arc timeline which shows this more accurately. |
| Session table with score column | Moved to the Threads tab where it fits naturally. Sessions in review was duplicated. |
| Activity calendar | Nice to have, but breaks the flow. Can be a separate `Trends` tab. |
| Three suggestions | Replaced by one commitment. |
| Pattern emoji icons | Replaced by consistent SVG icons matching the rest of the app. |

---

## Implementation Plan

### Phase A — Data changes (1 day)

1. Add `acknowledged` and `dismissed` fields to `patterns` table in SQLite
2. Add `POST /api/v1/review/patterns/:id/acknowledge` and `/dismiss` endpoints
3. Add `GET /api/v1/trends?days=7` (already exists) — verify it returns the right shape for sparklines
4. No new frontend types needed — `Pattern` already has all required fields

### Phase B — Component rebuild (3 days)

1. **`ArcStrip`** — new shared component. Compressed 7am–now timeline with overlaid self-report dots and wall marker. Replaces `EnergyMap` and `SelfReportChart` in Review. Reuses the bucket data.

2. **`InsightStat`** — new shared component. Large number + label + 7-bar sparkline + direction arrow. Used in the three-numbers section.

3. **`SignalCard`** — new shared component. Pattern card with collapse/expand, static explanation copy, Acknowledge/Dismiss actions.

4. **`CommitmentCard`** — new shared component. Single commitment with inline edit, "Add to plan" and "Not today" actions. Calls `PUT /api/v1/tomorrow`.

5. **Rewrite `ReviewMode.tsx`** — wire all new components. Remove `rootCauses`, `leaks`, session table, calendar. Keep `EnergyMap` available but not used here (move to potential Trends tab).

### Phase C — Copy writing (0.5 days)

Write the static `PATTERN_EXPLANATIONS` map in the frontend — one "What this means" and one "Actual cost" string per pattern kind. This is the most important work because it's what turns a fact into insight.

---

## Files changed

| File | Change |
|---|---|
| `backend/internal/store/store.go` | Add `acknowledged`, `dismissed` columns to `patterns` |
| `backend/internal/api/router.go` | 2 new endpoints: acknowledge, dismiss pattern |
| `frontend/src/components/modes/ReviewMode.tsx` | Full rewrite |
| `frontend/src/components/shared/ArcStrip.tsx` | New |
| `frontend/src/components/shared/InsightStat.tsx` | New |
| `frontend/src/components/shared/SignalCard.tsx` | New |
| `frontend/src/components/shared/CommitmentCard.tsx` | New |
| `frontend/src/styles/review.css` (if exists) or `modes.css` | Update review styles |

---

## Design principles for this redesign

1. **Every section ends with a decision, not a fact.** Patterns → acknowledge or dismiss. Suggestions → add or skip. The review is complete when the user has made all decisions, not when they finish reading.

2. **Trend over snapshot.** A number without context is noise. Every metric gets its 7-day trend so the user can see if they're improving.

3. **One commitment, not a list.** The system picks the single highest-leverage change. The user can edit it in their own words. They either commit or skip.

4. **Arc first, details later.** The timeline strip is the first thing. Everything else is detail that can be collapsed.

5. **Remove what doesn't change behavior.** Root causes and energy leaks were there because they could be computed. That's not a good enough reason. They're gone.
