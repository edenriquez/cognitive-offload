package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// DetectPatterns analyzes today's data and persists any detected patterns.
func DetectPatterns(ctx context.Context, db *store.DB, day string) ([]models.Pattern, error) {
	buckets, err := db.BucketsByDay(ctx, day)
	if err != nil {
		return nil, err
	}
	sessions, err := db.SessionsByDay(ctx, day)
	if err != nil {
		return nil, err
	}

	var patterns []models.Pattern
	now := time.Now()

	// 1. Thrashing detection — windows with many short sessions
	patterns = append(patterns, detectThrashing(sessions, day, now)...)

	// 2. Post-lunch crash — activity drop 13:00-15:00 vs morning peak
	if p := detectPostLunchCrash(buckets, day, now); p != nil {
		patterns = append(patterns, *p)
	}

	// 3. Fatigue / past-cutoff work — high errors in late buckets
	if p := detectFatigueWork(buckets, day, now); p != nil {
		patterns = append(patterns, *p)
	}

	// 4. Stuck sessions — long duration, low message count
	patterns = append(patterns, detectStuckSessions(sessions, day, now)...)

	// 5. Open loops — unclosed sessions
	if p := detectOpenLoops(sessions, day, now); p != nil {
		patterns = append(patterns, *p)
	}

	// Persist new patterns
	for _, p := range patterns {
		db.InsertPattern(ctx, p)
	}

	return patterns, nil
}

func detectThrashing(sessions []models.Session, day string, now time.Time) []models.Pattern {
	if len(sessions) < 5 {
		return nil
	}

	// Group sessions into 30-minute windows
	type window struct {
		start    time.Time
		count    int
		totalDur time.Duration
	}

	windows := make(map[int]*window) // key = 30-min bucket index

	for _, s := range sessions {
		h := s.StartedAt.Hour()
		m := s.StartedAt.Minute()
		idx := (h*60 + m) / 30

		if windows[idx] == nil {
			bucketStart := time.Date(now.Year(), now.Month(), now.Day(), 0, idx*30, 0, 0, now.Location())
			windows[idx] = &window{start: bucketStart}
		}
		windows[idx].count++

		if s.EndedAt != nil {
			windows[idx].totalDur += s.EndedAt.Sub(s.StartedAt)
		} else {
			windows[idx].totalDur += 3 * time.Minute // estimate for open sessions
		}
	}

	var patterns []models.Pattern
	for _, w := range windows {
		if w.count >= 5 {
			avgMin := 0
			if w.count > 0 {
				avgMin = int(w.totalDur.Minutes()) / w.count
			}
			endTime := w.start.Add(30 * time.Minute)
			patterns = append(patterns, models.Pattern{
				ID:         fmt.Sprintf("thrash-%s-%d", day, w.start.Unix()),
				Day:        day,
				Kind:       "thrashing",
				Severity:   "high",
				Title:      fmt.Sprintf("%d sessions in 30 min", w.count),
				Detail:     fmt.Sprintf("Avg duration %dm. Likely context fragmentation.", avgMin),
				Window:     fmt.Sprintf("%s–%s", w.start.Format("15:04"), endTime.Format("15:04")),
				Evidence:   map[string]any{"count": w.count, "avg_min": avgMin},
				DetectedAt: time.Now(),
			})
		}
	}
	return patterns
}

func detectPostLunchCrash(buckets []models.Bucket, day string, now time.Time) *models.Pattern {
	// Compare morning peak (09:00-11:30) vs afternoon (13:00-14:30)
	var morningSum, morningCount, afternoonSum, afternoonCount int
	for _, b := range buckets {
		if b.Hour >= 9.0 && b.Hour < 11.5 {
			morningSum += b.Activity
			morningCount++
		}
		if b.Hour >= 13.0 && b.Hour < 14.5 {
			afternoonSum += b.Activity
			afternoonCount++
		}
	}

	if morningCount == 0 || afternoonCount == 0 {
		return nil
	}

	morningAvg := float64(morningSum) / float64(morningCount)
	afternoonAvg := float64(afternoonSum) / float64(afternoonCount)

	if morningAvg <= 0 {
		return nil
	}

	drop := (morningAvg - afternoonAvg) / morningAvg
	if drop < 0.4 {
		return nil
	}

	return &models.Pattern{
		ID:         fmt.Sprintf("crash-%s", day),
		Day:        day,
		Kind:       "crash",
		Severity:   "medium",
		Title:      fmt.Sprintf("Activity dropped %.0f%% post-lunch", drop*100),
		Detail:     fmt.Sprintf("Morning avg: %.0f, afternoon avg: %.0f.", morningAvg, afternoonAvg),
		Window:     "13:00–14:30",
		Evidence:   map[string]any{"drop_pct": int(drop * 100), "morning_avg": int(morningAvg), "afternoon_avg": int(afternoonAvg)},
		DetectedAt: time.Now(),
	}
}

func detectFatigueWork(buckets []models.Bucket, day string, now time.Time) *models.Pattern {
	// Check for high error rates in buckets after 16:30
	var lateErrors, lateCount, earlyErrors, earlyCount int
	for _, b := range buckets {
		if b.Hour >= 16.5 && b.Activity > 10 {
			lateErrors += b.Errors
			lateCount++
		}
		if b.Hour >= 9.0 && b.Hour < 12.0 {
			earlyErrors += b.Errors
			earlyCount++
		}
	}

	if lateCount == 0 || lateErrors == 0 {
		return nil
	}

	earlyRate := 0.0
	if earlyCount > 0 {
		earlyRate = float64(earlyErrors) / float64(earlyCount)
	}
	lateRate := float64(lateErrors) / float64(lateCount)

	spike := 0.0
	if earlyRate > 0 {
		spike = (lateRate - earlyRate) / earlyRate * 100
	} else if lateRate > 0 {
		spike = 100
	}

	if spike < 50 {
		return nil
	}

	return &models.Pattern{
		ID:         fmt.Sprintf("fatigue-%s", day),
		Day:        day,
		Kind:       "fatigue",
		Severity:   "high",
		Title:      fmt.Sprintf("Error rate +%.0f%% past cutoff", spike),
		Detail:     "Working past cognitive cutoff with elevated error rate.",
		Window:     "16:30–now",
		Evidence:   map[string]any{"error_spike_pct": int(spike), "late_errors": lateErrors},
		DetectedAt: time.Now(),
	}
}

func detectStuckSessions(sessions []models.Session, day string, now time.Time) []models.Pattern {
	var patterns []models.Pattern
	for _, s := range sessions {
		if s.Status != "open" && s.Status != "stalled" {
			continue
		}
		duration := now.Sub(s.StartedAt)
		if duration < 90*time.Minute {
			continue
		}
		if s.MessageCount > 20 {
			continue // active session, not stuck
		}

		patterns = append(patterns, models.Pattern{
			ID:         fmt.Sprintf("stuck-%s-%s", day, s.ID),
			Day:        day,
			Kind:       "stuck",
			Severity:   "medium",
			Title:      fmt.Sprintf("%s — %s open, %d msgs", s.Label, formatDuration(duration), s.MessageCount),
			Detail:     "Long-running session with low interaction. Checkpoint or archive.",
			Window:     fmt.Sprintf("%s–now", s.StartedAt.Format("15:04")),
			Evidence:   map[string]any{"duration_min": int(duration.Minutes()), "messages": s.MessageCount, "session_id": s.ID},
			DetectedAt: time.Now(),
		})
	}
	return patterns
}

func detectOpenLoops(sessions []models.Session, day string, now time.Time) *models.Pattern {
	open := 0
	var labels []string
	for _, s := range sessions {
		if s.Status == "open" || s.Status == "stalled" {
			open++
			if len(labels) < 3 {
				labels = append(labels, s.Label)
			}
		}
	}
	if open < 3 {
		return nil
	}

	detail := ""
	for i, l := range labels {
		if i > 0 {
			detail += " · "
		}
		detail += l
	}
	if open > len(labels) {
		detail += fmt.Sprintf(" + %d more", open-len(labels))
	}

	return &models.Pattern{
		ID:         fmt.Sprintf("loops-%s", day),
		Day:        day,
		Kind:       "open-loops",
		Severity:   "medium",
		Title:      fmt.Sprintf("%d open threads", open),
		Detail:     detail,
		Window:     "all day",
		Evidence:   map[string]any{"open_count": open},
		DetectedAt: time.Now(),
	}
}

func formatDuration(d time.Duration) string {
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	if h > 0 {
		return fmt.Sprintf("%dh%dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}
