package engine

import (
	"context"
	"math"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// BudgetAllocation represents a single project's budget allocation
type BudgetAllocation struct {
	ProjectPath string  `json:"project_path"`
	ProjectName string  `json:"project_name"`
	PlannedPct  float64 `json:"planned_pct"`
	ActualPct   float64 `json:"actual_pct"`
	ActualMin   int     `json:"actual_min"`
	Deviation   float64 `json:"deviation"` // actual - planned (positive = over-invested)
}

// BudgetSummary is the full budget comparison for a day
type BudgetSummary struct {
	Day            string             `json:"day"`
	Allocations    []BudgetAllocation `json:"allocations"`
	TotalActiveMin int                `json:"total_active_min"`
	MaxDeviation   float64            `json:"max_deviation"` // largest absolute deviation
}

// ComputeBudget calculates actual time-per-project from bucket and event data.
// projectBudgets maps project_path -> planned percentage (0-100).
// If no budget is set, returns actual distribution only.
//
// NOTE: Until events carry a project_id (Phase 14), all time is attributed to
// a single "_unattributed" bucket. Once project tags exist, event-level
// attribution will replace the bucket-based approximation used here.
func ComputeBudget(ctx context.Context, db *store.DB, day string, projectBudgets map[string]float64) BudgetSummary {
	summary := BudgetSummary{Day: day}

	buckets, err := db.BucketsByDay(ctx, day)
	if err != nil {
		return summary
	}

	// Calculate total active minutes from 10-min buckets.
	// A bucket counts as active when its activity score exceeds the noise floor.
	totalActiveMin := 0
	for _, b := range buckets {
		if b.Activity > 5 {
			totalActiveMin += 10
		}
	}
	summary.TotalActiveMin = totalActiveMin

	// Attempt per-project breakdown via event-level data.
	// QueryEventsInWindow returns kind->count; we use it to enrich totals
	// but cannot split by project yet.
	projectMinutes := projectMinutesFromBuckets(buckets)

	// Guard against division by zero.
	divisor := totalActiveMin
	if divisor == 0 {
		divisor = 1
	}

	for proj, mins := range projectMinutes {
		actualPct := float64(mins) / float64(divisor) * 100
		plannedPct := projectBudgets[proj] // 0 if not budgeted

		alloc := BudgetAllocation{
			ProjectPath: proj,
			ProjectName: extractName(proj),
			PlannedPct:  plannedPct,
			ActualPct:   math.Round(actualPct*10) / 10,
			ActualMin:   mins,
			Deviation:   math.Round((actualPct-plannedPct)*10) / 10,
		}
		summary.Allocations = append(summary.Allocations, alloc)

		if math.Abs(alloc.Deviation) > math.Abs(summary.MaxDeviation) {
			summary.MaxDeviation = alloc.Deviation
		}
	}

	return summary
}

// projectMinutesFromBuckets aggregates active minutes per project from buckets.
// Currently all minutes land in "_unattributed" because buckets have no
// project dimension. When per-project event tagging lands this function
// will be replaced by an event-scan approach.
func projectMinutesFromBuckets(buckets []models.Bucket) map[string]int {
	total := 0
	for _, b := range buckets {
		if b.Activity > 5 {
			total += 10
		}
	}
	if total == 0 {
		return nil
	}
	return map[string]int{"_unattributed": total}
}

// dayTimeRange returns the start and end unix-millisecond timestamps for a
// calendar day string (YYYY-MM-DD) in UTC.
func dayTimeRange(day string) (int64, int64) {
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return 0, 0
	}
	startMs := t.UnixMilli()
	endMs := t.Add(24 * time.Hour).UnixMilli()
	return startMs, endMs
}

// extractProjectFromEvent tries to determine which project an event belongs to
// based on its metadata (file path, session project field, etc.)
func extractProjectFromEvent(e models.RawEvent) string {
	if len(e.Metadata) == 0 {
		return ""
	}
	// Look for common project indicators in metadata map.
	for _, key := range []string{"project", "project_path", "cwd"} {
		if v, ok := e.Metadata[key]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return "" // Will be populated when events are tagged with project_id in Phase 14
}

func extractName(path string) string {
	if path == "_unattributed" {
		return "Other"
	}
	// Get last path component
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}
