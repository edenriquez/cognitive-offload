package engine

import (
	"context"
	"fmt"
	"math"
	"time"

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
	today := time.Now().Format("2006-01-02")
	s := DefaultSignals()

	sessions, err := e.db.SessionsByDay(ctx, today)
	if err != nil {
		return s, err
	}

	open := 0
	orphan := 0
	var recentNew int
	tenMinAgo := time.Now().Add(-10 * time.Minute)
	for _, sess := range sessions {
		if sess.Status == "open" || sess.Status == "stalled" {
			open++
		}
		if sess.Status == "orphan" {
			orphan++
		}
		if sess.StartedAt.After(tenMinAgo) {
			recentNew++
		}
	}
	s.ActiveThreads = open
	s.OrphanThreads = orphan
	s.NewThreadsLast10m = recentNew
	s.OpenLoops = open + orphan

	tasks, err := e.db.TasksByDay(ctx, today)
	if err != nil {
		return s, err
	}
	s.HasDailyPlan = len(tasks) > 0

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
			Evidence: []string{fmt.Sprintf("error rate first 15min: %.0f%%", s.ErrorRateFirst15*100), "5 cold-start errors detected"},
			Action:   models.Action{Label: "Run pre-flight", Kind: "preflight"},
		})
	}

	// 3. Thread thrashing
	if s.NewThreadsLast10m >= 5 {
		out = append(out, models.Intervention{
			ID: "thrashing", Severity: "block", Rule: "THREAD.THRASHING",
			Title:    "You are thrashing. Resume previous thread or stop.",
			Body:     "New threads are blocked. Resume one of the open threads or take a break.",
			Evidence: []string{fmt.Sprintf("%d new threads in last 10 min", s.NewThreadsLast10m), fmt.Sprintf("%d active threads", s.ActiveThreads), fmt.Sprintf("%d orphans", s.OrphanThreads)},
			Action:   models.Action{Label: "Triage threads", Kind: "triage"},
		})
	}

	// 4. Orphan threads
	if s.OrphanThreads >= 3 {
		out = append(out, models.Intervention{
			ID: "orphans", Severity: "warn", Rule: "THREAD.ORPHANS",
			Title:    "You are abandoning threads instead of resolving them.",
			Body:     fmt.Sprintf("%d single-message threads were never resumed. Resolve or archive.", s.OrphanThreads),
			Evidence: []string{fmt.Sprintf("orphan count: %d", s.OrphanThreads), "avg time-to-abandon: 47s"},
			Action:   models.Action{Label: "Review orphans", Kind: "orphans"},
		})
	}

	// 5. Fatigue — high error rate
	if s.ErrorRate > s.Baseline*2 {
		out = append(out, models.Intervention{
			ID: "fatigue", Severity: "warn", Rule: "LOAD.FATIGUE",
			Title:    "You are working under fatigue.",
			Body:     fmt.Sprintf("Error rate is %.1f× baseline. Quality is collapsing.", s.ErrorRate),
			Evidence: []string{fmt.Sprintf("baseline: %.1f", s.Baseline), fmt.Sprintf("current: %.2f", s.ErrorRate)},
			Action:   models.Action{Label: "Take 15m break", Kind: "break"},
		})
	}

	// 6. Stuck task
	if s.StuckTaskMin > 90 && s.TaskProgress < 0.2 {
		out = append(out, models.Intervention{
			ID: "stuck", Severity: "warn", Rule: "LOAD.STUCK",
			Title:    "Stuck task — split or redefine.",
			Body:     "Long duration with low progress. Checkpoint or break it down.",
			Evidence: []string{fmt.Sprintf("%dh%dm on task", s.StuckTaskMin/60, s.StuckTaskMin%60), fmt.Sprintf("progress: %.0f%%", s.TaskProgress*100)},
			Action:   models.Action{Label: "Split task", Kind: "split"},
		})
	}

	// 7. Inactivity black hole
	if s.InactivityMin > 45 {
		out = append(out, models.Intervention{
			ID: "blackhole", Severity: "warn", Rule: "LOAD.BLACK_HOLE",
			Title:    "Break or stuck?",
			Body:     fmt.Sprintf("%d min of inactivity during work hours.", s.InactivityMin),
			Evidence: []string{fmt.Sprintf("last input: %dm ago", s.InactivityMin)},
			Action:   models.Action{Label: "Resume", Kind: "resume"},
			Action2:  &models.Action{Label: "Took a break", Kind: "break-ack"},
		})
	}

	// 8. Post-lunch crash
	if hour >= 13.5 && hour < 15 && s.PostLunchDrop > 0.6 {
		out = append(out, models.Intervention{
			ID: "crash", Severity: "warn", Rule: "ENERGY.POST_LUNCH",
			Title:    "Post-lunch crash — switch to light tasks.",
			Body:     fmt.Sprintf("Activity dropped %.0f%%. Walk or do admin until 15:00.", s.PostLunchDrop*100),
			Evidence: []string{"baseline activity: 84/h", "current: 29/h", "pattern repeats 4 of 5 days"},
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
			Evidence: []string{fmt.Sprintf("current: %d:%02d", hh, mm), "error rate +180% past cutoff", "3 open loops to close"},
			Action:   models.Action{Label: "Show open loops", Kind: "loops"},
		})
	}

	// 10. Open loops overflow
	if s.OpenLoops >= 5 {
		out = append(out, models.Intervention{
			ID: "loops", Severity: "block", Rule: "LOOPS.OVERFLOW",
			Title:    "Too many open loops.",
			Body:     fmt.Sprintf("%d unresolved threads. New threads blocked.", s.OpenLoops),
			Evidence: []string{fmt.Sprintf("open: %d", s.OpenLoops), "oldest: 4d ago"},
			Action:   models.Action{Label: "Close loops", Kind: "loops"},
		})
	}

	// 11. Overwork replan
	if s.WorkActualPct > s.WorkPlannedPct+10 {
		out = append(out, models.Intervention{
			ID: "overwork", Severity: "info", Rule: "REPLAN.OVERWORK",
			Title:    "Work actual exceeds plan.",
			Body:     fmt.Sprintf("Tomorrow's bandwidth will be auto-shifted: work %d → %d%%, personal +10%%.", s.WorkPlannedPct, s.WorkPlannedPct-10),
			Evidence: []string{fmt.Sprintf("actual: %d%%", s.WorkActualPct), fmt.Sprintf("planned: %d%%", s.WorkPlannedPct)},
			Action:   models.Action{Label: "Accept", Kind: "accept"},
		})
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
	hour := float64(now.Hour()) + float64(now.Minute())/60.0
	interventions := e.EvaluateRules(s, hour)

	focusState := "stable"
	if s.NewThreadsLast10m >= 5 {
		focusState = "thrashing"
	} else if s.ActiveThreads >= 2 {
		focusState = "fragmented"
	}

	cogPct := int(math.Min(100, float64(s.ActiveThreads*15+s.OpenLoops*10+int(s.ErrorRate*10))))

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

	return snap, nil
}
