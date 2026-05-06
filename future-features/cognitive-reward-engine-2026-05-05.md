# 🧠 ADDENDUM — MICRO-REWARD BEHAVIORAL SYSTEM (MANDATORY)

The system MUST implement a non-intrusive micro-reward engine designed to reinforce high-quality cognitive behavior.

This is NOT gamification.

It is a behavioral reinforcement layer that:

* rewards correct decisions
* reinforces focus continuity
* encourages loop closure
* promotes recovery from bad states

---

# 🎯 CORE PRINCIPLE

Reward decisions, not activity.

DO:

* reinforce staying focused
* reinforce closing work
* reinforce stopping at the right time

DO NOT:

* reward task creation
* reward raw activity
* reward volume of work

---

# ⚙️ 1. REWARD ENGINE ARCHITECTURE

The system MUST include:

Event Layer → Rule Engine → Reward Engine → UI

Reward engine API:

rewardEngine.emit(event_type, context)

---

# 🧩 2. REWARD TYPES

## Focus Rewards

Triggered by sustained work on a single thread

## Closure Rewards

Triggered when loops/tasks are completed

## Decision Rewards

Triggered when user avoids a bad action

## Recovery Rewards

Triggered when user exits degraded states

## Smart Stop Rewards

Triggered when user stops before cognitive degradation

---

# 🔁 3. EVENT → REWARD MAPPING

## Thread Continuity (Focus Streak)

IF active thread continues without switching
→ emit FOCUS_STREAK

UI:

* subtle progress indicator
* “Focus X min”
* continuous animation (no jumps)

Reset silently on thread switch (no penalty UI)

---

## Loop Closure

IF task/thread marked complete
→ emit LOOP_CLOSED

UI:

* micro animation (<300ms)
* minimal feedback:
  “Loop closed”

---

## Good Decision

IF risky action detected AND user avoids it
→ emit GOOD_DECISION

UI:

* inline text near action
* disappears automatically

Example:
“Good call. Staying focused.”

---

## Recovery

IF state changes from degraded → stable
→ emit RECOVERY

UI:

* smooth transition in signal bar
* minimal feedback:
  “Recovered focus”

---

## Smart Stop

IF user stops work before degraded state
→ emit SMART_STOP

UI (end-of-day):
“You stopped before degradation”

---

# 🎨 4. UI COMPONENTS

## RewardToast

* appears bottom corner
* auto-dismiss (<1.5s)
* max 1 visible at a time

---

## ThreadStreakIndicator

* embedded in active thread
* shows continuity duration
* subtle animation

---

## InlineRewardHint

* appears near user action
* 1 line max
* fades automatically

---

## Signal Bar Enhancement

* reflects positive transitions
* subtle glow on improvement
* no aggressive animation

---

# 🚫 5. NON-INTRUSIVE CONSTRAINTS

FORBIDDEN:

* modals
* blocking dialogs
* loud notifications
* gamification elements (points, badges, levels)

---

# ⚖️ 6. ANTI-SPAM RULES

Reward system MUST avoid noise.

## Cooldown

Each reward type has a cooldown (~5 minutes)

---

## Density Limit

IF >3 rewards in 10 minutes
→ suppress additional rewards

---

## Priority

Only show highest priority reward:

SMART_STOP > RECOVERY > GOOD_DECISION > LOOP_CLOSED > FOCUS_STREAK

---

# 🧠 7. ADAPTIVE FEEDBACK

The system MUST reduce feedback over time.

IF user behavior improves:
→ decrease reward frequency

Goal:
User internalizes behavior without external reinforcement

---

# 📊 8. DAILY SUMMARY INTEGRATION

At end of day:

DO NOT list all rewards.

INSTEAD show summary:

* Focus recoveries
* Loops closed
* Good decisions made
* Smart stop events

---

# 🧠 9. EXPERIENCE PRINCIPLES

The system MUST:

* feel natural, not gamified
* reinforce behavior subconsciously
* reward timing, not output
* prioritize subtlety over visibility

---

# 🎯 FINAL REQUIREMENT

The user should feel:

“I made good decisions today”

—not—

“I completed many tasks”

---

Failure to maintain subtlety or overusing rewards makes the system incorrect.
