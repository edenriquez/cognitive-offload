package ingest

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type IdleDetector struct {
	db            *store.DB
	idleThreshold time.Duration
	lastActivity  time.Time
	isIdle        bool
	mu            sync.Mutex
	stopCh        chan struct{}
}

func NewIdleDetector(db *store.DB, threshold time.Duration) *IdleDetector {
	return &IdleDetector{
		db:            db,
		idleThreshold: threshold,
		lastActivity:  time.Now(),
		isIdle:        false,
		stopCh:        make(chan struct{}),
	}
}

// RecordActivity should be called whenever any event occurs (file save, git commit, prompt, etc.)
func (d *IdleDetector) RecordActivity() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.lastActivity = time.Now()
}

func (d *IdleDetector) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-d.stopCh:
				return
			case <-ticker.C:
				d.check(ctx)
			}
		}
	}()

	slog.Info("idle detector started", "threshold", d.idleThreshold)
}

func (d *IdleDetector) Stop() {
	close(d.stopCh)
}

func (d *IdleDetector) check(ctx context.Context) {
	d.mu.Lock()
	lastActivity := d.lastActivity
	wasIdle := d.isIdle
	d.mu.Unlock()

	now := time.Now()
	day := now.Format("2006-01-02")
	idleDuration := now.Sub(lastActivity)

	if idleDuration >= d.idleThreshold && !wasIdle {
		// Transition: active → idle
		d.mu.Lock()
		d.isIdle = true
		d.mu.Unlock()

		event := models.RawEvent{
			Timestamp: now,
			Source:    "system",
			Kind:      "idle_start",
			Day:       day,
			Metadata: map[string]any{
				"idle_since":    lastActivity.Format(time.RFC3339),
				"idle_duration": int(idleDuration.Seconds()),
			},
		}
		if err := d.db.InsertEvents(ctx, []models.RawEvent{event}); err != nil {
			slog.Error("idle detector insert failed", "error", err)
		}
		slog.Info("idle detected", "since", lastActivity.Format("15:04:05"), "duration", idleDuration.Round(time.Second))

	} else if idleDuration < d.idleThreshold && wasIdle {
		// Transition: idle → active
		d.mu.Lock()
		d.isIdle = false
		d.mu.Unlock()

		event := models.RawEvent{
			Timestamp: now,
			Source:    "system",
			Kind:      "idle_end",
			Day:       day,
			Metadata: map[string]any{
				"idle_duration": int(now.Sub(lastActivity).Seconds()),
			},
		}
		if err := d.db.InsertEvents(ctx, []models.RawEvent{event}); err != nil {
			slog.Error("idle detector insert failed", "error", err)
		}
		slog.Info("activity resumed after idle")
	}
}
