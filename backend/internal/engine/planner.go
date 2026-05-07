package engine

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// GeneratePlan creates tomorrow's plan from today's review data.
func GeneratePlan(ctx context.Context, db *store.DB, today string, tomorrow string) *models.Plan {
	patterns, _ := db.PatternsByDay(ctx, today)
	summary := ComputeDaySummary(ctx, db, today)
	sessions, _ := db.SessionsByDay(ctx, today)
	todayTasks, _ := db.TasksByDay(ctx, today)

	now := time.Now()
	plan := &models.Plan{
		Day:         tomorrow,
		Status:      "draft",
		GeneratedAt: &now,
	}

	// ---------- Derive constraints from patterns ----------
	plan.Constraints = deriveConstraints(patterns, summary)

	// ---------- Adjust bandwidth from actual vs planned ----------
	plan.Bandwidth = adjustBandwidth(summary, todayTasks)

	// ---------- Generate headline ----------
	plan.Headline = generateHeadline(patterns, summary)

	// ---------- Pre-select tasks ----------
	plan.Tasks = preselectTasks(sessions, todayTasks)

	return plan
}

func deriveConstraints(patterns []models.Pattern, summary models.DaySummary) []models.Constraint {
	var constraints []models.Constraint
	seen := make(map[string]bool)

	for _, p := range patterns {
		switch p.Kind {
		case "fatigue":
			if !seen["cutoff"] {
				seen["cutoff"] = true
				constraints = append(constraints, models.Constraint{
					Rule:        "CUTOFF",
					Title:       "Earlier cutoff tomorrow.",
					Description: "Error spike detected past cutoff. Pull cutoff forward to protect quality.",
					Locked:      true,
				})
			}

		case "thrashing":
			if !seen["thread_cap"] {
				seen["thread_cap"] = true
				constraints = append(constraints, models.Constraint{
					Rule:        "THREAD_CAP",
					Title:       "1 active thread cap.",
					Description: "Session thrashing detected. New sessions blocked until close-or-archive.",
					Locked:      true,
				})
			}

		case "crash":
			if !seen["recovery"] {
				seen["recovery"] = true
				constraints = append(constraints, models.Constraint{
					Rule:        "RECOVERY",
					Title:       "Recovery block after lunch.",
					Description: "Post-lunch crash detected. Schedule light tasks 13:00–14:00.",
					Locked:      true,
				})
			}

		case "stuck":
			if !seen["checkpoint"] {
				seen["checkpoint"] = true
				constraints = append(constraints, models.Constraint{
					Rule:        "CHECKPOINT",
					Title:       "Checkpoint stuck tasks first.",
					Description: "Stuck session detected. Resolve, split, or archive before starting new work.",
					Locked:      true,
				})
			}

		case "open-loops":
			if !seen["close_loops"] {
				seen["close_loops"] = true
				constraints = append(constraints, models.Constraint{
					Rule:        "CLOSE_LOOPS",
					Title:       fmt.Sprintf("Close %d open threads.", summary.OpenLoops),
					Description: "Too many open threads. Triage before starting new sessions.",
					Locked:      true,
				})
			}
		}
	}

	// If deep work was low, add a focus block constraint
	if summary.DeepWorkMin < 120 && summary.DeepWorkMin > 0 {
		constraints = append(constraints, models.Constraint{
			Rule:        "FOCUS_BLOCK",
			Title:       "Protected deep work 09:00–11:00.",
			Description: fmt.Sprintf("Only %dmin deep work today. Block morning for uninterrupted focus.", summary.DeepWorkMin),
			Locked:      true,
		})
	}

	return constraints
}

func adjustBandwidth(summary models.DaySummary, tasks []models.Task) models.Bandwidth {
	// Default
	bw := models.Bandwidth{Work: 60, Personal: 15, Admin: 15, Learning: 10}

	// If leaked time was high, reduce work and add recovery
	if summary.LeakedMin > 60 {
		bw.Work = 50
		bw.Personal = 20
		bw.Admin = 20
		bw.Learning = 10
	}

	// If deep work was very low, shift toward focus
	if summary.DeepWorkMin < 60 {
		bw.Work = 55
		bw.Personal = 20
		bw.Admin = 15
		bw.Learning = 10
	}

	// Check if personal tasks were neglected
	personalDone := 0
	personalTotal := 0
	for _, t := range tasks {
		if t.Kind == "personal" {
			personalTotal++
			if t.Done {
				personalDone++
			}
		}
	}
	if personalTotal > 0 && personalDone == 0 {
		// Personal was completely neglected — force higher allocation
		bw.Personal = int(math.Max(float64(bw.Personal), 20))
		bw.Work = 100 - bw.Personal - bw.Admin - bw.Learning
	}

	return bw
}

func generateHeadline(patterns []models.Pattern, summary models.DaySummary) string {
	if len(patterns) == 0 {
		if summary.DeepWorkMin > 180 {
			return "Strong day. Keep the momentum — protect your peak hours."
		}
		return "Plan your day. Set your MUST WINs and lock in."
	}

	hasFatigue := false
	hasThrashing := false
	hasCrash := false
	for _, p := range patterns {
		switch p.Kind {
		case "fatigue":
			hasFatigue = true
		case "thrashing":
			hasThrashing = true
		case "crash":
			hasCrash = true
		}
	}

	if hasFatigue && hasThrashing {
		return "Recovery day. One thread, earlier cutoff, no fatigue work."
	}
	if hasFatigue {
		return "Protect your energy. Earlier cutoff, lighter load."
	}
	if hasThrashing {
		return "Focus day. One thread at a time, close before opening."
	}
	if hasCrash {
		return "Adjust your rhythm. Light tasks after lunch, deep work in the morning."
	}

	return fmt.Sprintf("Address %d patterns from today. Constraints applied.", len(patterns))
}

func preselectTasks(sessions []models.Session, todayTasks []models.Task) []models.Task {
	var tasks []models.Task
	idx := 1

	// 1. Carry over uncompleted MUST tasks from today
	for _, t := range todayTasks {
		if !t.Done && t.Kind == "must" {
			tasks = append(tasks, models.Task{
				ID:   fmt.Sprintf("plan-%d", idx),
				Kind: "must",
				Idx:  idx,
				Text: t.Text,
			})
			idx++
			if idx > 3 {
				break // Cap at 3 must tasks
			}
		}
	}

	// 2. Add open session resolutions
	for _, s := range sessions {
		if idx > 3 {
			break
		}
		if s.Status == "open" || s.Status == "stalled" {
			// Check if this session's topic is already covered by a carried task
			alreadyCovered := false
			for _, t := range tasks {
				if t.Text == s.Label {
					alreadyCovered = true
					break
				}
			}
			if !alreadyCovered {
				tasks = append(tasks, models.Task{
					ID:   fmt.Sprintf("plan-%d", idx),
					Kind: "must",
					Idx:  idx,
					Text: fmt.Sprintf("Resolve: %s", s.Label),
				})
				idx++
			}
		}
	}

	// 3. Carry over uncompleted personal tasks
	for _, t := range todayTasks {
		if !t.Done && t.Kind == "personal" {
			tasks = append(tasks, models.Task{
				ID:   fmt.Sprintf("plan-p%d", idx),
				Kind: "personal",
				Idx:  idx,
				Text: t.Text,
			})
			idx++
			break // Only 1 personal task
		}
	}

	return tasks
}
