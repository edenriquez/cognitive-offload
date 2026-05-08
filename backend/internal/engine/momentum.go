package engine

import (
	"context"
	"math"
	"time"

	"github.com/cogload/backend/internal/store"
)

// Momentum tracks cumulative cognitive throughput for the day.
type Momentum struct {
	TotalMessages int     `json:"total_messages"`
	TotalSessions int     `json:"total_sessions"`
	TotalSaves    int     `json:"total_saves"`
	TotalCommits  int     `json:"total_commits"`
	ActiveMinutes int     `json:"active_minutes"`
	Velocity      float64 `json:"velocity"`      // events per hour (last 30 min)
	PeakVelocity  float64 `json:"peak_velocity"` // highest velocity today
	Acceleration  float64 `json:"acceleration"`  // velocity change vs prior 30-min window
	WallDetected  bool    `json:"wall_detected"`
	WallTime      string  `json:"wall_time,omitempty"` // HH:MM when wall was hit
}

// MomentumPoint represents a single time-series data point for the momentum chart.
type MomentumPoint struct {
	Hour         float64 `json:"hour"`
	CumMessages  int     `json:"cum_messages"`
	CumSaves     int     `json:"cum_saves"`
	CumSessions  int     `json:"cum_sessions"`
	OutputPerMsg float64 `json:"output_per_msg"` // saves / max(1, messages) for this window
}

// allTrackedKinds is the union of message + save + commit event kinds for velocity.
var allTrackedKinds = []string{"prompt", "claude_user_msg", "file_save", "file_create", "git_commit"}

// countKindsSince sums RecentEventCount for multiple kinds since a timestamp (ms).
func countKindsSince(ctx context.Context, db *store.DB, day string, sinceMs int64, kinds []string) int {
	total := 0
	for _, k := range kinds {
		c, _ := db.RecentEventCount(ctx, day, k, sinceMs)
		total += c
	}
	return total
}

// sumKindsFromCounts totals event counts for the given kinds from a kind→count map.
func sumKindsFromCounts(counts map[string]int, kinds []string) int {
	total := 0
	for _, k := range kinds {
		total += counts[k]
	}
	return total
}

// ComputeMomentum calculates the day's cumulative cognitive throughput.
func ComputeMomentum(ctx context.Context, db *store.DB, day string) Momentum {
	m := Momentum{}
	now := time.Now()

	dayStart, err := time.ParseInLocation("2006-01-02", day, time.Local)
	if err != nil {
		return m
	}
	dayStartMs := dayStart.UnixMilli()
	nowMs := now.UnixMilli()

	// ---------- Totals for the whole day ----------
	dayCounts, err := db.QueryEventsInWindow(ctx, day, dayStartMs, nowMs)
	if err != nil {
		return m
	}
	m.TotalMessages = dayCounts["prompt"] + dayCounts["claude_user_msg"]
	m.TotalSaves = dayCounts["file_save"] + dayCounts["file_create"]
	m.TotalCommits = dayCounts["git_commit"]

	// Sessions from the session table (more accurate than events).
	sessions, _ := db.SessionsByDay(ctx, day)
	m.TotalSessions = len(sessions)

	// Active minutes from 10-min buckets.
	buckets, _ := db.BucketsByDay(ctx, day)
	for _, b := range buckets {
		if b.Activity > 5 {
			m.ActiveMinutes += 10
		}
	}

	// ---------- Velocity (events per hour, measured over last 30 min) ----------
	thirtyMinAgoMs := now.Add(-30 * time.Minute).UnixMilli()
	recentCount := countKindsSince(ctx, db, day, thirtyMinAgoMs, allTrackedKinds)
	m.Velocity = float64(recentCount) * 2.0 // 30-min window → per hour

	// ---------- Peak velocity (best 1-hour window today) ----------
	for h := 7; h < 22; h++ {
		windowStartMs := dayStart.Add(time.Duration(h) * time.Hour).UnixMilli()
		windowEndMs := dayStart.Add(time.Duration(h+1) * time.Hour).UnixMilli()
		if windowStartMs > nowMs {
			break // don't count future windows
		}
		if windowEndMs > nowMs {
			windowEndMs = nowMs
		}
		hourCounts, err := db.QueryEventsInWindow(ctx, day, windowStartMs, windowEndMs)
		if err != nil {
			continue
		}
		hourTotal := float64(sumKindsFromCounts(hourCounts, allTrackedKinds))
		if hourTotal > m.PeakVelocity {
			m.PeakVelocity = hourTotal
		}
	}
	if m.PeakVelocity == 0 {
		m.PeakVelocity = m.Velocity
	}

	// ---------- Acceleration (current 30-min velocity vs prior 30-min window) ----------
	sixtyMinAgoMs := now.Add(-60 * time.Minute).UnixMilli()
	// Events in the window [-60min, -30min] = total since -60min minus total since -30min
	prevWindowCount := 0
	for _, k := range allTrackedKinds {
		total, _ := db.RecentEventCount(ctx, day, k, sixtyMinAgoMs)
		recent, _ := db.RecentEventCount(ctx, day, k, thirtyMinAgoMs)
		prevWindowCount += total - recent
	}
	prevVelocity := float64(prevWindowCount) * 2.0
	if prevVelocity > 0 {
		m.Acceleration = (m.Velocity - prevVelocity) / prevVelocity
	}

	// ---------- Wall detection (morning output-per-msg ratio vs current hour) ----------
	morningStartMs := dayStart.Add(7 * time.Hour).UnixMilli()
	morningEndMs := dayStart.Add(10 * time.Hour).UnixMilli()
	morningCounts, _ := db.QueryEventsInWindow(ctx, day, morningStartMs, morningEndMs)
	morningMsgs := morningCounts["prompt"] + morningCounts["claude_user_msg"]
	morningSaves := morningCounts["file_save"] + morningCounts["file_create"]

	currentStartMs := now.Add(-60 * time.Minute).UnixMilli()
	currentCounts, _ := db.QueryEventsInWindow(ctx, day, currentStartMs, nowMs)
	currentMsgs := currentCounts["prompt"] + currentCounts["claude_user_msg"]
	currentSaves := currentCounts["file_save"] + currentCounts["file_create"]

	morningRatio := float64(morningSaves) / math.Max(1, float64(morningMsgs))
	currentRatio := float64(currentSaves) / math.Max(1, float64(currentMsgs))

	if morningMsgs >= 5 && currentMsgs >= 3 && morningRatio > 0 {
		decay := (morningRatio - currentRatio) / morningRatio
		if decay > 0.5 {
			m.WallDetected = true
			// Rough estimate: the wall hit ~30 min before now.
			m.WallTime = now.Add(-30 * time.Minute).Format("15:04")
		}
	}

	return m
}

// ComputeMomentumTimeline returns time-series data points for the momentum chart.
// Each point covers a 30-minute window from 07:00 to 22:00.
func ComputeMomentumTimeline(ctx context.Context, db *store.DB, day string) []MomentumPoint {
	dayStart, err := time.ParseInLocation("2006-01-02", day, time.Local)
	if err != nil {
		return nil
	}
	nowMs := time.Now().UnixMilli()

	var points []MomentumPoint
	cumMsgs, cumSaves, cumSessions := 0, 0, 0

	for idx := 0; idx < 30; idx++ { // 30 half-hour slots: 07:00–22:00
		hour := 7.0 + float64(idx)*0.5
		minuteOffset := int(hour*60) - 7*60 + 7*60 // minutes from midnight
		windowStartMs := dayStart.Add(time.Duration(minuteOffset) * time.Minute).UnixMilli()
		windowEndMs := dayStart.Add(time.Duration(minuteOffset+30) * time.Minute).UnixMilli()

		if windowStartMs > nowMs {
			break // don't produce points in the future
		}

		counts, err := db.QueryEventsInWindow(ctx, day, windowStartMs, windowEndMs)
		msgs, saves, sessions := 0, 0, 0
		if err == nil {
			msgs = counts["prompt"] + counts["claude_user_msg"]
			saves = counts["file_save"] + counts["file_create"]
			sessions = counts["zed_thread_start"]
		}

		cumMsgs += msgs
		cumSaves += saves
		cumSessions += sessions

		opm := 0.0
		if msgs > 0 {
			opm = float64(saves) / float64(msgs)
		}

		points = append(points, MomentumPoint{
			Hour:         hour,
			CumMessages:  cumMsgs,
			CumSaves:     cumSaves,
			CumSessions:  cumSessions,
			OutputPerMsg: opm,
		})
	}
	return points
}
