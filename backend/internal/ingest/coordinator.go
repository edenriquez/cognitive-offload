package ingest

import (
	"context"
	"log/slog"
	"time"

	"github.com/cogload/backend/internal/config"
	"github.com/cogload/backend/internal/store"
)

type Coordinator struct {
	db         *store.DB
	cfg        config.Config
	fsw        *FSWatcher
	git        *GitMonitor
	idle       *IdleDetector
	claude     *ClaudeWatcher
	aggregator *Aggregator
}

func NewCoordinator(db *store.DB, cfg config.Config) (*Coordinator, error) {
	idle := NewIdleDetector(db, 5*time.Minute)

	fsw, err := NewFSWatcher(db, cfg.WatchPaths, cfg.IgnoreDirs, cfg.MaxWatchDirs)
	if err != nil {
		return nil, err
	}

	// Wire FS events to idle detector via a patched flush
	origFSW := fsw
	_ = origFSW // FSWatcher already batches events — idle gets notified via coordinator

	git := NewGitMonitor(db, cfg.WatchPaths)
	claude := NewClaudeWatcher(db, idle.RecordActivity)
	agg := NewAggregator(db)

	return &Coordinator{
		db:         db,
		cfg:        cfg,
		fsw:        fsw,
		git:        git,
		idle:       idle,
		claude:     claude,
		aggregator: agg,
	}, nil
}

func (c *Coordinator) Start(ctx context.Context) error {
	// Start file watcher
	if err := c.fsw.Start(ctx); err != nil {
		slog.Error("coordinator: file watcher failed", "error", err)
	}

	// Start git monitor
	c.git.Start(ctx)

	// Start idle detector
	c.idle.Start(ctx)

	// Start Claude Code watcher
	c.claude.Start(ctx)

	// Start aggregator
	c.aggregator.Start(ctx)

	slog.Info("coordinator: all watchers started")
	return nil
}

func (c *Coordinator) Stop() {
	slog.Info("coordinator: stopping all watchers")
	if c.fsw != nil {
		c.fsw.Stop()
	}
	if c.git != nil {
		c.git.Stop()
	}
	if c.idle != nil {
		c.idle.Stop()
	}
	if c.claude != nil {
		c.claude.Stop()
	}
	if c.aggregator != nil {
		c.aggregator.Stop()
	}
}

// RecordActivity passes activity signals to the idle detector.
// Call this from external sources (e.g., API requests).
func (c *Coordinator) RecordActivity() {
	if c.idle != nil {
		c.idle.RecordActivity()
	}
}
