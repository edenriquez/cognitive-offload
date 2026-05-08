package engine

import (
	"context"

	"github.com/cogload/backend/internal/store"
)

// ProjectOutput holds productivity metrics for a single project on a given day
type ProjectOutput struct {
	ProjectPath     string  `json:"project_path"`
	ProjectName     string  `json:"project_name"`
	Kind            string  `json:"kind"` // work, personal, side
	SessionCount    int     `json:"session_count"`
	TotalMessages   int     `json:"total_messages"`
	FileSaves       int     `json:"file_saves"`
	GitCommits      int     `json:"git_commits"`
	ActiveMinutes   int     `json:"active_minutes"`
	AvgSessionScore float64 `json:"avg_session_score"`
}

// ComputeProjectOutputs builds per-project productivity summaries for a day.
//
// It combines three data sources that are available today:
//   - BucketsByDay  → active minutes & file-save counts per 10-min window
//   - SessionsByDay → LLM session / message counts
//   - QueryEventsInWindow → event-kind breakdown (git_commit, prompt, etc.)
//
// Because events do not yet carry a project_id, all metrics are aggregated
// under a single "_unattributed" project entry.  When per-project tagging
// lands (Phase 14), this function will partition by project.
func ComputeProjectOutputs(ctx context.Context, db *store.DB, day string) []ProjectOutput {
	buckets, err := db.BucketsByDay(ctx, day)
	if err != nil {
		return nil
	}

	// Aggregate bucket-level totals.
	activeMinutes := 0
	fileSaves := 0
	for _, b := range buckets {
		if b.Activity > 5 {
			activeMinutes += 10
		}
		fileSaves += b.FileSaves
	}

	// Nothing happened this day — return early.
	if activeMinutes == 0 && fileSaves == 0 {
		return nil
	}

	// Session totals.
	sessions, _ := db.SessionsByDay(ctx, day)
	sessionCount := len(sessions)
	totalMessages := 0
	for _, s := range sessions {
		totalMessages += s.MessageCount
	}

	// Event-kind breakdown for the full day (git commits, prompts, etc.).
	startMs, endMs := dayTimeRange(day)
	gitCommits := 0
	if startMs > 0 {
		kindCounts, err := db.QueryEventsInWindow(ctx, day, startMs, endMs)
		if err == nil {
			gitCommits += kindCounts["git_commit"]
		}
	}

	// Build the single (for now) project output.
	out := ProjectOutput{
		ProjectPath:   "_unattributed",
		ProjectName:   extractName("_unattributed"),
		SessionCount:  sessionCount,
		TotalMessages: totalMessages,
		FileSaves:     fileSaves,
		GitCommits:    gitCommits,
		ActiveMinutes: activeMinutes,
	}

	return []ProjectOutput{out}
}
