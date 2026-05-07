package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/cogload/backend/internal/config"
	"github.com/cogload/backend/internal/models"
)

// setTestHome points HOME at a temp dir so config.Load() returns defaults
// (empty DisabledRules) without touching the real filesystem.
func setTestHome(t *testing.T) {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	// Write a minimal config with no disabled rules so Load() is predictable
	dir := filepath.Join(tmp, ".cogload")
	os.MkdirAll(dir, 0755)
	cfg := config.DefaultConfig()
	cfg.DisabledRules = []string{}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(filepath.Join(dir, "config.json"), data, 0644)
}

// newEngine creates an Engine with a nil DB — fine for EvaluateRules which
// only reads Signals and config.
func newEngine() *Engine {
	return New(nil)
}

// findRule returns the first Intervention matching the given rule, or nil.
func findRule(interventions []Intervention, rule string) *Intervention {
	for i := range interventions {
		if interventions[i].Rule == rule {
			return &interventions[i]
		}
	}
	return nil
}

// hasRule checks if any intervention matches the given rule.
func hasRule(interventions []Intervention, rule string) bool {
	return findRule(interventions, rule) != nil
}

// Intervention is re-exported here to avoid importing models in every helper.
// Actually we need to use models.Intervention in the slice — let's just use
// the return type directly.
type Intervention = models.Intervention

func TestEvaluateRules_NoPlan(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = false

	result := e.EvaluateRules(s, 10.0) // 10:00 AM

	if !hasRule(result, "COLD_START.NO_PLAN") {
		t.Error("expected COLD_START.NO_PLAN intervention when HasDailyPlan is false")
	}

	iv := findRule(result, "COLD_START.NO_PLAN")
	if iv.Severity != "block" {
		t.Errorf("COLD_START.NO_PLAN severity = %q, want %q", iv.Severity, "block")
	}
}

func TestEvaluateRules_WithPlan(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true

	result := e.EvaluateRules(s, 10.0)

	if hasRule(result, "COLD_START.NO_PLAN") {
		t.Error("should NOT produce COLD_START.NO_PLAN when HasDailyPlan is true")
	}
}

func TestEvaluateRules_PerfDegradation(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.NewThreadsLast10m = 5

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "LOAD.PERF_DEGRADATION") {
		t.Error("expected LOAD.PERF_DEGRADATION when NewThreadsLast10m >= 5")
	}

	iv := findRule(result, "LOAD.PERF_DEGRADATION")
	if iv.Severity != "block" {
		t.Errorf("LOAD.PERF_DEGRADATION severity = %q, want %q", iv.Severity, "block")
	}
}

func TestEvaluateRules_PerfDegradation_BelowThreshold(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.NewThreadsLast10m = 4

	result := e.EvaluateRules(s, 10.0)

	if hasRule(result, "LOAD.PERF_DEGRADATION") {
		t.Error("should NOT produce LOAD.PERF_DEGRADATION when NewThreadsLast10m < 5")
	}
}

func TestEvaluateRules_Orphans(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.OrphanThreads = 3

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "THREAD.ORPHANS") {
		t.Error("expected THREAD.ORPHANS when OrphanThreads >= 3")
	}

	iv := findRule(result, "THREAD.ORPHANS")
	if iv.Severity != "warn" {
		t.Errorf("THREAD.ORPHANS severity = %q, want %q", iv.Severity, "warn")
	}
}

func TestEvaluateRules_Orphans_BelowThreshold(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.OrphanThreads = 2

	result := e.EvaluateRules(s, 10.0)

	if hasRule(result, "THREAD.ORPHANS") {
		t.Error("should NOT produce THREAD.ORPHANS when OrphanThreads < 3")
	}
}

func TestEvaluateRules_Fatigue(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.Baseline = 2.0
	s.ErrorRate = 5.0 // 5.0 > 2.0*2 = 4.0

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "LOAD.FATIGUE") {
		t.Error("expected LOAD.FATIGUE when ErrorRate > Baseline*2")
	}

	iv := findRule(result, "LOAD.FATIGUE")
	if iv.Severity != "warn" {
		t.Errorf("LOAD.FATIGUE severity = %q, want %q", iv.Severity, "warn")
	}
}

func TestEvaluateRules_Fatigue_AtThreshold(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.Baseline = 2.0
	s.ErrorRate = 4.0 // exactly Baseline*2, not greater

	result := e.EvaluateRules(s, 10.0)

	if hasRule(result, "LOAD.FATIGUE") {
		t.Error("should NOT produce LOAD.FATIGUE when ErrorRate == Baseline*2 (needs >)")
	}
}

func TestEvaluateRules_PastCutoff(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.CutoffHour = 16.5

	result := e.EvaluateRules(s, 17.0) // past cutoff

	if !hasRule(result, "CUTOFF.PAST") {
		t.Error("expected CUTOFF.PAST when hour > CutoffHour")
	}

	iv := findRule(result, "CUTOFF.PAST")
	if iv.Severity != "block" {
		t.Errorf("CUTOFF.PAST severity = %q, want %q", iv.Severity, "block")
	}
}

func TestEvaluateRules_BeforeCutoff(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.CutoffHour = 16.5

	result := e.EvaluateRules(s, 14.0) // before cutoff

	if hasRule(result, "CUTOFF.PAST") {
		t.Error("should NOT produce CUTOFF.PAST when hour < CutoffHour")
	}
}

func TestEvaluateRules_Stable(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	// All-clear signals
	s := DefaultSignals()
	s.HasDailyPlan = true
	s.NewThreadsLast10m = 0
	s.OrphanThreads = 0
	s.ErrorRate = 0
	s.Baseline = 1.0
	s.InactivityMin = 0
	s.PostLunchDrop = 0
	s.StuckTaskMin = 0
	s.OpenLoops = 0
	s.CutoffHour = 22.0 // very late cutoff
	s.WorkActualPct = 30
	s.WorkPlannedPct = 60

	result := e.EvaluateRules(s, 10.0)

	if len(result) != 0 {
		rules := make([]string, len(result))
		for i, iv := range result {
			rules[i] = iv.Rule
		}
		t.Errorf("expected no interventions for stable signals, got %d: %v", len(result), rules)
	}
}

func TestEvaluateRules_BlackHole(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.InactivityMin = 50

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "LOAD.BLACK_HOLE") {
		t.Error("expected LOAD.BLACK_HOLE when InactivityMin > 45")
	}
}

func TestEvaluateRules_Stuck(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.StuckTaskMin = 100
	s.TaskProgress = 0.1

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "LOAD.STUCK") {
		t.Error("expected LOAD.STUCK when StuckTaskMin > 90 and TaskProgress < 0.2")
	}
}

func TestEvaluateRules_PostLunchCrash(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.PostLunchDrop = 0.6

	result := e.EvaluateRules(s, 14.0) // within the 13.5-15.0 window

	if !hasRule(result, "ENERGY.POST_LUNCH") {
		t.Error("expected ENERGY.POST_LUNCH when PostLunchDrop > 0.5 during 13.5-15.0")
	}
}

func TestEvaluateRules_OpenLoopsOverflow(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.OpenLoops = 5

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "LOOPS.OVERFLOW") {
		t.Error("expected LOOPS.OVERFLOW when OpenLoops >= 5")
	}
}

func TestEvaluateRules_Overwork(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.WorkActualPct = 80
	s.WorkPlannedPct = 60 // 80 > 60+10

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "REPLAN.OVERWORK") {
		t.Error("expected REPLAN.OVERWORK when WorkActualPct > WorkPlannedPct + 10")
	}

	iv := findRule(result, "REPLAN.OVERWORK")
	if iv.Severity != "info" {
		t.Errorf("REPLAN.OVERWORK severity = %q, want %q", iv.Severity, "info")
	}
}

func TestEvaluateRules_MultipleInterventions(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = false // triggers NO_PLAN
	s.OrphanThreads = 5    // triggers ORPHANS
	s.OpenLoops = 5        // triggers LOOPS.OVERFLOW

	result := e.EvaluateRules(s, 10.0)

	if !hasRule(result, "COLD_START.NO_PLAN") {
		t.Error("expected COLD_START.NO_PLAN")
	}
	if !hasRule(result, "THREAD.ORPHANS") {
		t.Error("expected THREAD.ORPHANS")
	}
	if !hasRule(result, "LOOPS.OVERFLOW") {
		t.Error("expected LOOPS.OVERFLOW")
	}
}

func TestEvaluateRules_DisabledRules(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)

	// Write config with disabled rules
	dir := filepath.Join(tmp, ".cogload")
	os.MkdirAll(dir, 0755)
	cfg := config.DefaultConfig()
	cfg.DisabledRules = []string{"COLD_START.NO_PLAN", "THREAD.ORPHANS"}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(filepath.Join(dir, "config.json"), data, 0644)

	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = false // would trigger NO_PLAN
	s.OrphanThreads = 5    // would trigger ORPHANS
	s.OpenLoops = 5        // triggers LOOPS.OVERFLOW (not disabled)

	result := e.EvaluateRules(s, 10.0)

	if hasRule(result, "COLD_START.NO_PLAN") {
		t.Error("COLD_START.NO_PLAN should be filtered out by disabled rules")
	}
	if hasRule(result, "THREAD.ORPHANS") {
		t.Error("THREAD.ORPHANS should be filtered out by disabled rules")
	}
	if !hasRule(result, "LOOPS.OVERFLOW") {
		t.Error("LOOPS.OVERFLOW should NOT be filtered — it is not disabled")
	}
}

func TestEvaluateRules_ColdStartEnv(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.ErrorRateFirst15 = 0.6 // > 0.5

	result := e.EvaluateRules(s, 9.0) // before 10:00

	if !hasRule(result, "COLD_START.ENV") {
		t.Error("expected COLD_START.ENV when ErrorRateFirst15 > 0.5 and hour < 10")
	}
}

func TestEvaluateRules_ColdStartEnv_AfterMorning(t *testing.T) {
	setTestHome(t)
	e := newEngine()

	s := DefaultSignals()
	s.HasDailyPlan = true
	s.ErrorRateFirst15 = 0.6

	// Should NOT trigger past 10:00
	result := e.EvaluateRules(s, 11.0)

	if hasRule(result, "COLD_START.ENV") {
		t.Error("COLD_START.ENV should NOT trigger when hour >= 10")
	}
}

func TestDefaultSignals(t *testing.T) {
	s := DefaultSignals()

	if s.Baseline != 1.0 {
		t.Errorf("Baseline = %f, want 1.0", s.Baseline)
	}
	if s.CutoffHour != 16.5 {
		t.Errorf("CutoffHour = %f, want 16.5", s.CutoffHour)
	}
	if s.HasDailyPlan {
		t.Error("HasDailyPlan should be false by default")
	}
	if s.WorkPlannedPct != 60 {
		t.Errorf("WorkPlannedPct = %d, want 60", s.WorkPlannedPct)
	}
}
