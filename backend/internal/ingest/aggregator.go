package ingest

import (
	"context"
	"log/slog"
	"math"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type Aggregator struct {
	db     *store.DB
	stopCh chan struct{}
}

func NewAggregator(db *store.DB) *Aggregator {
	return &Aggregator{
		db:     db,
		stopCh: make(chan struct{}),
	}
}

func (a *Aggregator) Start(ctx context.Context) {
	// Run immediately on start, then every 10 minutes
	a.Aggregate(ctx)

	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-a.stopCh:
				return
			case <-ticker.C:
				a.Aggregate(ctx)
			}
		}
	}()

	slog.Info("aggregator started", "interval", "10m")
}

func (a *Aggregator) Stop() {
	close(a.stopCh)
}

func (a *Aggregator) Aggregate(ctx context.Context) {
	now := time.Now()
	day := now.Format("2006-01-02")

	// Calculate current bucket index (0-143, each bucket = 10 minutes)
	currentBucket := (now.Hour()*60 + now.Minute()) / 10

	// Aggregate all buckets from start of day to now
	for idx := 0; idx <= currentBucket; idx++ {
		bucketStart := time.Date(now.Year(), now.Month(), now.Day(), 0, idx*10, 0, 0, now.Location())
		bucketEnd := bucketStart.Add(10 * time.Minute)

		counts, err := a.countEventsInWindow(ctx, day, bucketStart, bucketEnd)
		if err != nil {
			slog.Error("aggregator count failed", "bucket", idx, "error", err)
			continue
		}

		// Skip empty buckets
		if counts.total == 0 {
			continue
		}

		// Compute activity density (0-100)
		// In a 10-min window, peak work looks like: 15+ saves, 3+ sessions, 30+ events
		// Scale each dimension to 0-33, sum to 0-100
		savesScore := math.Min(33, float64(counts.fileSaves)*2.2) // 15 saves = 33
		sessScore := math.Min(33, float64(counts.sessions)*11)    // 3 sessions = 33
		otherCount := counts.total - counts.fileSaves - counts.sessions
		otherScore := math.Min(34, float64(otherCount)*1.1) // 30 other = 33
		activity := int(savesScore + sessScore + otherScore)
		if activity < 3 && counts.total > 0 {
			activity = 3 // minimum visibility
		}

		hour := float64(idx*10) / 60.0

		// Approximate idle seconds from activity density.
		// A 10-min bucket = 600 seconds; idle is the complement of active time.
		idleSec := 600 - (activity * 600 / 100)
		if idleSec < 0 {
			idleSec = 0
		}

		bucket := models.Bucket{
			Day:       day,
			BucketIdx: idx,
			Hour:      hour,
			Activity:  activity,
			Errors:    counts.errors,
			Sessions:  counts.sessions,
			FileSaves: counts.fileSaves,
			IdleSec:   idleSec,
		}

		if err := a.db.UpsertBucket(ctx, bucket); err != nil {
			slog.Error("aggregator upsert failed", "bucket", idx, "error", err)
		}
	}

	slog.Debug("aggregator completed", "day", day, "buckets", currentBucket+1)
}

type eventCounts struct {
	total     int
	fileSaves int
	errors    int
	sessions  int
}

func (a *Aggregator) countEventsInWindow(ctx context.Context, day string, start, end time.Time) (eventCounts, error) {
	var c eventCounts

	// Count by kind in this 10-minute window
	rows, err := a.db.QueryEventsInWindow(ctx, day, start.UnixMilli(), end.UnixMilli())
	if err != nil {
		return c, err
	}

	for kind, count := range rows {
		c.total += count
		switch kind {
		case "file_save", "file_create":
			c.fileSaves += count
		case "error":
			c.errors += count
		case "session_start", "zed_thread_start":
			c.sessions += count
		case "prompt":
			c.sessions++ // count as 1 session touch, not per-prompt
		}
	}

	return c, nil
}
