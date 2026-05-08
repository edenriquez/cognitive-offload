package engine

import (
	"context"
	"math"
	"time"

	"github.com/cogload/backend/internal/store"
)

// SessionScore holds the productivity metrics for a single LLM session.
type SessionScore struct {
	SessionID    string `json:"session_id"`
	OutputScore  int    `json:"output_score"` // 0-100
	FileSaves    int    `json:"file_saves"`   // saves within ±5min of session
	Commits      int    `json:"commits"`      // commits within ±5min of session
	MessageCount int    `json:"message_count"`
	DurationMin  int    `json:"duration_min"`
}

// ScoreSession computes a productivity score for a single session.
// It looks at file saves and git commits in a ±5 minute window around
// the session's active period using QueryEventsInWindow.
func ScoreSession(ctx context.Context, db *store.DB, sessionID string, day string, startedAt time.Time, endedAt *time.Time, messageCount int) SessionScore {
	const windowPad = 5 * time.Minute

	windowStart := startedAt.Add(-windowPad).UnixMilli()

	end := time.Now()
	if endedAt != nil {
		end = *endedAt
	}
	windowEnd := end.Add(windowPad).UnixMilli()

	// QueryEventsInWindow returns map[kind]count for the given day & ms range.
	fileSaves := 0
	commits := 0
	counts, err := db.QueryEventsInWindow(ctx, day, windowStart, windowEnd)
	if err == nil {
		fileSaves = counts["file_save"] + counts["file_create"]
		commits = counts["git_commit"]
	}

	// Score formula: (file_saves + commits*3) / max(1, message_count) * normalisation
	rawScore := float64(fileSaves+commits*3) / math.Max(1, float64(messageCount))
	// Normalise: 1.0 ratio → 50 score, 2.0 → 75, 3.0+ → 90+
	normalized := int(math.Min(100, rawScore*50))

	durationMin := 0
	if endedAt != nil && endedAt.After(startedAt) {
		durationMin = int(endedAt.Sub(startedAt).Minutes())
	}

	return SessionScore{
		SessionID:    sessionID,
		OutputScore:  normalized,
		FileSaves:    fileSaves,
		Commits:      commits,
		MessageCount: messageCount,
		DurationMin:  durationMin,
	}
}

// ScoreAllSessions computes scores for all sessions on a given day.
func ScoreAllSessions(ctx context.Context, db *store.DB, day string) []SessionScore {
	sessions, err := db.SessionsByDay(ctx, day)
	if err != nil {
		return nil
	}

	var scores []SessionScore
	for _, s := range sessions {
		score := ScoreSession(ctx, db, s.ID, s.Day, s.StartedAt, s.EndedAt, s.MessageCount)
		scores = append(scores, score)
	}
	return scores
}

// SessionScoreSummary provides aggregate metrics for the day's sessions.
type SessionScoreSummary struct {
	HighLeverage  int     `json:"high_leverage"` // sessions scoring ≥60
	LowOutput     int     `json:"low_output"`    // sessions scoring <30
	AvgHighScore  float64 `json:"avg_high_score"`
	AvgLowScore   float64 `json:"avg_low_score"`
	TotalSessions int     `json:"total_sessions"`
}

// SummarizeSessionScores buckets the scored sessions into high-leverage (≥60)
// and low-output (<30) groups with their respective averages.
func SummarizeSessionScores(scores []SessionScore) SessionScoreSummary {
	summary := SessionScoreSummary{TotalSessions: len(scores)}
	var highSum, lowSum float64

	for _, s := range scores {
		if s.OutputScore >= 60 {
			summary.HighLeverage++
			highSum += float64(s.OutputScore)
		} else if s.OutputScore < 30 {
			summary.LowOutput++
			lowSum += float64(s.OutputScore)
		}
	}

	if summary.HighLeverage > 0 {
		summary.AvgHighScore = highSum / float64(summary.HighLeverage)
	}
	if summary.LowOutput > 0 {
		summary.AvgLowScore = lowSum / float64(summary.LowOutput)
	}
	return summary
}
