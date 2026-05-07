package engine

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/cogload/backend/internal/config"
	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type Engine struct {
	db *store.DB
}

func New(db *store.DB) *Engine {
	return &Engine{db: db}
}

// Signals holds real-time state derived from data.
type Signals struct {
	ActiveThreads     int
	NewThreadsLast10m int
	OrphanThreads     int
	ErrorRate         float64
	ErrorRateFirst15  float64
	Baseline          float64
	InactivityMin     int
	PostLunchDrop     float64
	StuckTaskMin      int
	TaskProgress      float64
	OpenLoops         int
	CutoffHour        float64
	InPeak            bool
	HasDailyPlan      bool
	WorkActualPct     int
	WorkPlannedPct    int
}

// DefaultSignals returns a clean baseline when no data exists yet.
func DefaultSignals() Signals {
	return Signals{
		ActiveThreads:     0,
		NewThreadsLast10m: 0,
		OrphanThreads:     0,
		ErrorRate:         0,
		ErrorRateFirst15:  0,
		Baseline:          1.0,
		InactivityMin:     0,
		PostLunchDrop:     0,
		StuckTaskMin:      0,
		TaskProgress:      0,
		OpenLoops:         0,
		CutoffHour:        16.5,
		InPeak:            false,
		HasDailyPlan:      false,
		WorkActualPct:     0,
		WorkPlannedPct:    60,
	}
}

// ComputeSignals derives real-time signals from stored data.
func (e *Engine) ComputeSignals(ctx context.Context) (Signals, error) {
	now := time.Now()
	today := now.Format("2006-01-02")
	hour := float64(now.Hour()) + float64(now.Minute())/60.0
	s := DefaultSignals()

	// ---------- Sessions (LLM threads) ----------
	sessions, err := e.db.SessionsByDay(ctx, today)
	if err != nil {
		return s, err
	}

	open := 0
	orphan := 0
	for _, sess := range sessions {
		if sess.Status == "open" || sess.Status == "stalled" {
			open++
		}
		if sess.Status == "orphan" {
			orphan++
		}
	}
	s.ActiveThreads = open
	s.OrphanThreads = orphan
	s.OpenLoops = open + orphan

	// New sessions in last 10 minutes
	tenMinAgo := now.Add(-10 * time.Minute).Unix()
	newSessions, _ := e.db.SessionCountSince(ctx, today, tenMinAgo)
	s.NewThreadsLast10m = newSessions

	// Single-message orphan-like sessions
	singleMsg, _ := e.db.SingleMessageSessions(ctx, today)
	if singleMsg > s.OrphanThreads {
		s.OrphanThreads = singleMsg
	}

	// ---------- Tasks ----------
	tasks, err := e.db.TasksByDay(ctx, today)
	if err != nil {
		return s, err
	}
	s.HasDailyPlan = len(tasks) > 0

	// Compute task progress (done / total)
	if len(tasks) > 0 {
		done := 0
		for _, t := range tasks {
			if t.Done {
				done++
			}
		}
		s.TaskProgress = float64(done) / float64(len(tasks))
	}

	// ---------- Activity from buckets ----------
	recentBuckets, _ := e.db.RecentBuckets(ctx, today, 3) // last 30 min

	// Current activity level
	if len(recentBuckets) > 0 {
		// Peak detection: is activity in top range?
		avgActivity := 0
		for _, b := range recentBuckets {
			avgActivity += b.Activity
		}
		avgActivity /= len(recentBuckets)
		s.InPeak = avgActivity > 60
	}

	// ---------- Error rate ----------
	// Count error events in last 30 min vs morning baseline
	thirtyMinAgo := now.Add(-30 * time.Minute).UnixMilli()
	recentErrors, _ := e.db.RecentEventCount(ctx, today, "error", thirtyMinAgo)
	// Baseline: errors per 30min in the morning (09:00-11:00)
	morningBuckets, _ := e.db.BucketsInRange(ctx, today, 9.0, 11.0)
	morningErrors := 0
	for _, b := range morningBuckets {
		morningErrors += b.Errors
	}
	if len(morningBuckets) > 0 {
		s.Baseline = math.Max(1.0, float64(morningErrors)/float64(len(morningBuckets)))
	}
	if s.Baseline > 0 {
		s.ErrorRate = float64(recentErrors) / s.Baseline
	}

	// Error rate in first 15 min of the day
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	first15End := dayStart.Add(15 * time.Minute).UnixMilli()
	earlyErrors, _ := e.db.RecentEventCount(ctx, today, "error", dayStart.UnixMilli())
	// Only count events before the 15min mark
	earlyTotal, _ := e.db.RecentEventCountBySource(ctx, today, "editor", dayStart.UnixMilli())
	if earlyTotal > 0 && now.Sub(dayStart) < 30*time.Minute {
		_ = first15End // used conceptually
		s.ErrorRateFirst15 = float64(earlyErrors) / float64(earlyTotal)
	}

	// ---------- Inactivity ----------
	lastEventTs, _ := e.db.LastEventTimestamp(ctx, today)
	if lastEventTs > 0 {
		lastEvent := time.UnixMilli(lastEventTs)
		s.InactivityMin = int(now.Sub(lastEvent).Minutes())
	}

	// ---------- Post-lunch crash ----------
	if hour >= 13.5 && hour < 15.5 {
		morningPeak, _ := e.db.BucketsInRange(ctx, today, 9.0, 11.5)
		afternoonDip, _ := e.db.BucketsInRange(ctx, today, 13.5, hour)

		peakAvg := 0.0
		if len(morningPeak) > 0 {
			sum := 0
			for _, b := range morningPeak {
				sum += b.Activity
			}
			peakAvg = float64(sum) / float64(len(morningPeak))
		}
		dipAvg := 0.0
		if len(afternoonDip) > 0 {
			sum := 0
			for _, b := range afternoonDip {
				sum += b.Activity
			}
			dipAvg = float64(sum) / float64(len(afternoonDip))
		}
		if peakAvg > 0 {
			s.PostLunchDrop = (peakAvg - dipAvg) / peakAvg
		}
	}

	// ---------- Stuck task ----------
	focusMin, _ := e.db.ActiveFocusMinutes(ctx)
	if focusMin > 0 {
		s.StuckTaskMin = focusMin
	}

	// ---------- Cutoff + Work actual ----------
	cfg := config.Load()
	s.CutoffHour = cfg.CutoffHour

	// Compute work actual percentage from today's activity
	allBuckets, _ := e.db.BucketsByDay(ctx, today)
	activeBuckets := 0
	for _, b := range allBuckets {
		if b.Activity > 10 {
			activeBuckets++
		}
	}
	// Each bucket = 10min. Full day = 6h productive = 36 buckets at 100%
	if activeBuckets > 0 {
		s.WorkActualPct = int(math.Min(100, float64(activeBuckets)/36.0*100))
	}

	return s, nil
}

// EvaluateRules returns active interventions sorted by severity.
func (e *Engine) EvaluateRules(s Signals, hour float64) []models.Intervention {
	var out []models.Intervention

	// 1. Cold start — no plan
	if !s.HasDailyPlan {
		out = append(out, models.Intervention{
			ID: "no-plan", Severity: "block", Rule: "COLD_START.NO_PLAN",
			Title:    "Define your day before starting work.",
			Body:     "You have not defined any MUST tasks for today. Execution is blocked until a plan exists.",
			Evidence: []string{"0 must-win tasks defined", "0 personal task defined"},
			Action:   models.Action{Label: "Plan today", Kind: "plan"},
		})
	}

	// 2. Cold start — env errors
	if s.ErrorRateFirst15 > 0.5 && hour < 10 {
		out = append(out, models.Intervention{
			ID: "env-broken", Severity: "block", Rule: "COLD_START.ENV",
			Title:    "Fix your environment before starting.",
			Body:     "Cold-start errors are above threshold. Deep work is blocked.",
			Evidence: []string{fmt.Sprintf("error rate first 15min: %.0f%%", s.ErrorRateFirst15*100)},
			Action:   models.Action{Label: "Run pre-flight", Kind: "preflight"},
		})
	}

	// 3. Performance degradation
	if s.NewThreadsLast10m >= 5 {
		out = append(out, models.Intervention{
			ID: "perf-degradation", Severity: "block", Rule: "LOAD.PERF_DEGRADATION",
			Title: "Performance degradation detected. Too many concurrent threads.",
			Body:  fmt.Sprintf("%d new threads in last 10 min. Resume one or take a break.", s.NewThreadsLast10m),
			Evidence: []string{
				fmt.Sprintf("%d new threads in last 10 min", s.NewThreadsLast10m),
				fmt.Sprintf("%d active threads", s.ActiveThreads),
				fmt.Sprintf("%d orphans", s.OrphanThreads),
			},
			Action: models.Action{Label: "Triage threads", Kind: "triage"},
		})
	}

	// 4. Orphan threads
	if s.OrphanThreads >= 3 {
		out = append(out, models.Intervention{
			ID: "orphans", Severity: "warn", Rule: "THREAD.ORPHANS",
			Title:    "You are abandoning threads instead of resolving them.",
			Body:     fmt.Sprintf("%d single-message threads were never resumed.", s.OrphanThreads),
			Evidence: []string{fmt.Sprintf("orphan count: %d", s.OrphanThreads)},
			Action:   models.Action{Label: "Review orphans", Kind: "orphans"},
		})
	}

	// 5. Fatigue — high error rate
	if s.ErrorRate > s.Baseline*2 && s.ErrorRate > 0 {
		out = append(out, models.Intervention{
			ID: "fatigue", Severity: "warn", Rule: "LOAD.FATIGUE",
			Title:    "You are working under fatigue.",
			Body:     fmt.Sprintf("Error rate is %.1f× baseline. Quality may be degrading.", s.ErrorRate),
			Evidence: []string{fmt.Sprintf("baseline: %.1f", s.Baseline), fmt.Sprintf("current: %.1f", s.ErrorRate)},
			Action:   models.Action{Label: "Take 15m break", Kind: "break"},
		})
	}

	// 6. Stuck task
	if s.StuckTaskMin > 90 && s.TaskProgress < 0.2 {
		out = append(out, models.Intervention{
			ID: "stuck", Severity: "warn", Rule: "LOAD.STUCK",
			Title: "Stuck task — split or redefine.",
			Body:  fmt.Sprintf("%dh%dm on current task with low progress.", s.StuckTaskMin/60, s.StuckTaskMin%60),
			Evidence: []string{
				fmt.Sprintf("focus time: %dh%dm", s.StuckTaskMin/60, s.StuckTaskMin%60),
				fmt.Sprintf("task progress: %.0f%%", s.TaskProgress*100),
			},
			Action: models.Action{Label: "Split task", Kind: "split"},
		})
	}

	// 7. Inactivity black hole
	if s.InactivityMin > 45 {
		out = append(out, models.Intervention{
			ID: "blackhole", Severity: "warn", Rule: "LOAD.BLACK_HOLE",
			Title:    "Break or stuck?",
			Body:     fmt.Sprintf("%d min of inactivity during work hours.", s.InactivityMin),
			Evidence: []string{fmt.Sprintf("last activity: %dm ago", s.InactivityMin)},
			Action:   models.Action{Label: "Resume", Kind: "resume"},
			Action2:  &models.Action{Label: "Took a break", Kind: "break-ack"},
		})
	}

	// 8. Post-lunch crash
	if hour >= 13.5 && hour < 15 && s.PostLunchDrop > 0.5 {
		out = append(out, models.Intervention{
			ID: "crash", Severity: "warn", Rule: "ENERGY.POST_LUNCH",
			Title:    "Post-lunch crash — switch to light tasks.",
			Body:     fmt.Sprintf("Activity dropped %.0f%% from morning peak.", s.PostLunchDrop*100),
			Evidence: []string{fmt.Sprintf("drop: %.0f%%", s.PostLunchDrop*100)},
			Action:   models.Action{Label: "Switch to admin", Kind: "admin"},
		})
	}

	// 9. Past cutoff
	if hour > s.CutoffHour {
		hh := int(math.Floor(hour))
		mm := int((hour - float64(hh)) * 60)
		out = append(out, models.Intervention{
			ID: "cutoff", Severity: "block", Rule: "CUTOFF.PAST",
			Title:    "Past cognitive cutoff. Only closing tasks allowed.",
			Body:     "New complex work is blocked. Close loops, then stop.",
			Evidence: []string{fmt.Sprintf("current: %d:%02d", hh, mm), fmt.Sprintf("cutoff: %.0f:%02.0f", math.Floor(s.CutoffHour), math.Mod(s.CutoffHour, 1)*60)},
			Action:   models.Action{Label: "Show open loops", Kind: "loops"},
		})
	}

	// 10. Open loops overflow
	if s.OpenLoops >= 5 {
		out = append(out, models.Intervention{
			ID: "loops", Severity: "block", Rule: "LOOPS.OVERFLOW",
			Title:    "Too many open loops.",
			Body:     fmt.Sprintf("%d unresolved threads. New threads blocked.", s.OpenLoops),
			Evidence: []string{fmt.Sprintf("open: %d", s.OpenLoops)},
			Action:   models.Action{Label: "Close loops", Kind: "loops"},
		})
	}

	// 11. Overwork replan
	if s.WorkActualPct > s.WorkPlannedPct+10 {
		out = append(out, models.Intervention{
			ID: "overwork", Severity: "info", Rule: "REPLAN.OVERWORK",
			Title:    "Work actual exceeds plan.",
			Body:     fmt.Sprintf("Actual: %d%%, planned: %d%%. Consider rebalancing tomorrow.", s.WorkActualPct, s.WorkPlannedPct),
			Evidence: []string{fmt.Sprintf("actual: %d%%", s.WorkActualPct), fmt.Sprintf("planned: %d%%", s.WorkPlannedPct)},
			Action:   models.Action{Label: "Accept", Kind: "accept"},
		})
	}

	// Filter disabled rules
	cfg := config.Load()
	if len(cfg.DisabledRules) > 0 {
		disabled := make(map[string]bool, len(cfg.DisabledRules))
		for _, r := range cfg.DisabledRules {
			disabled[r] = true
		}
		filtered := out[:0]
		for _, iv := range out {
			if !disabled[iv.Rule] {
				filtered = append(filtered, iv)
			}
		}
		out = filtered
	}

	return out
}

// SignalSnapshot computes a full snapshot for WS broadcast.
func (e *Engine) SignalSnapshot(ctx context.Context) (models.SignalSnapshot, error) {
	s, err := e.ComputeSignals(ctx)
	if err != nil {
		return models.SignalSnapshot{}, err
	}

	now := time.Now()
	today := now.Format("2006-01-02")
	hour := float64(now.Hour()) + float64(now.Minute())/60.0
	interventions := e.EvaluateRules(s, hour)

	focusState := "stable"
	if s.NewThreadsLast10m >= 5 {
		focusState = "degraded"
	} else if s.ActiveThreads >= 3 {
		focusState = "fragmented"
	} else if s.ActiveThreads >= 2 {
		focusState = "fragmented"
	}

	cogPct := int(math.Min(100, float64(s.ActiveThreads*15+s.OpenLoops*10+int(s.ErrorRate*10)+s.InactivityMin/2)))

	snap := models.SignalSnapshot{
		FocusState:      focusState,
		ActiveThreads:   s.ActiveThreads,
		ErrorRate:       s.ErrorRate,
		ErrorBaseline:   s.Baseline,
		OpenLoops:       s.OpenLoops,
		CutoffHour:      s.CutoffHour,
		CogThresholdPct: cogPct,
		Interventions:   interventions,
	}

	// Include active session info
	openSessions, _ := e.db.OpenSessions(ctx, today)
	if len(openSessions) > 0 {
		latest := openSessions[0]
		dur := int(now.Sub(latest.StartedAt).Minutes())
		snap.ActiveSession = &models.SessionBrief{
			ID:              latest.ID,
			Label:           latest.Label,
			DurationMin:     dur,
			LastTouchAgoSec: s.InactivityMin * 60,
		}
	}

	return snap, nil
}
