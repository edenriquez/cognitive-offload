package ingest

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cogload/backend/internal/config"
	"github.com/cogload/backend/internal/store"
)

type SourceStatus struct {
	Name        string `json:"name"`
	Type        string `json:"type"`   // file_watcher | git | idle | llm | aggregator
	Status      string `json:"status"` // active | inactive | error | not_found
	Detail      string `json:"detail"`
	EventsToday int    `json:"events_today"`
}

type Coordinator struct {
	db             *store.DB
	cfg            config.Config
	fsw            *FSWatcher
	git            *GitMonitor
	idle           *IdleDetector
	claude         *ClaudeWatcher
	claudeProjects *ClaudeProjectScanner
	zed            *ZedWatcher
	aggregator     *Aggregator
}

func NewCoordinator(db *store.DB, cfg config.Config) (*Coordinator, error) {
	idle := NewIdleDetector(db, 5*time.Minute)

	fsw, err := NewFSWatcher(db, cfg.WatchPaths, cfg.IgnoreDirs, cfg.MaxWatchDirs)
	if err != nil {
		return nil, err
	}

	git := NewGitMonitor(db, cfg.WatchPaths)
	claude := NewClaudeWatcher(db, idle.RecordActivity)
	claudeProjects := NewClaudeProjectScanner(db)
	zed := NewZedWatcher(db, idle.RecordActivity)
	agg := NewAggregator(db)

	return &Coordinator{
		db:             db,
		cfg:            cfg,
		fsw:            fsw,
		git:            git,
		idle:           idle,
		claude:         claude,
		claudeProjects: claudeProjects,
		zed:            zed,
		aggregator:     agg,
	}, nil
}

func (c *Coordinator) Start(ctx context.Context) error {
	if err := c.fsw.Start(ctx); err != nil {
		slog.Error("coordinator: file watcher failed", "error", err)
	}
	c.git.Start(ctx)
	c.idle.Start(ctx)
	c.claude.Start(ctx)
	c.claudeProjects.Start(ctx)
	c.zed.Start(ctx)
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
	if c.claudeProjects != nil {
		c.claudeProjects.Stop()
	}
	if c.zed != nil {
		c.zed.Stop()
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

// RunAggregator triggers an immediate aggregation cycle.
func (c *Coordinator) RunAggregator(ctx context.Context) {
	if c.aggregator != nil {
		c.aggregator.Aggregate(ctx)
	}
}

// Status returns the current status of all data sources.
func (c *Coordinator) Status(ctx context.Context) []SourceStatus {
	today := time.Now().Format("2006-01-02")
	home, _ := os.UserHomeDir()
	var sources []SourceStatus

	// File Watcher
	fsDirs := 0
	if c.fsw != nil {
		fsDirs = int(c.fsw.watchedCount.Load())
	}
	fsEvents, _ := c.db.RecentEventCountBySource(ctx, today, "editor", 0)
	fsStatus := "active"
	if fsDirs == 0 {
		fsStatus = "inactive"
	}
	sources = append(sources, SourceStatus{
		Name:        "File Watcher",
		Type:        "file_watcher",
		Status:      fsStatus,
		Detail:      fmt.Sprintf("%d directories watched", fsDirs),
		EventsToday: fsEvents,
	})

	// Git Monitor
	gitRepos := 0
	if c.git != nil {
		gitRepos = len(c.git.lastCommit)
	}
	gitEvents, _ := c.db.RecentEventCountBySource(ctx, today, "git", 0)
	gitStatus := "active"
	if gitRepos == 0 {
		gitStatus = "inactive"
	}
	sources = append(sources, SourceStatus{
		Name:        "Git Monitor",
		Type:        "git",
		Status:      gitStatus,
		Detail:      fmt.Sprintf("%d repos tracked", gitRepos),
		EventsToday: gitEvents,
	})

	// Claude Code (history.jsonl)
	claudePath := filepath.Join(home, ".claude", "history.jsonl")
	claudeStatus := "active"
	claudeDetail := claudePath
	if _, err := os.Stat(claudePath); os.IsNotExist(err) {
		claudeStatus = "not_found"
		claudeDetail = "~/.claude/history.jsonl not found"
	}
	claudeEvents, _ := c.db.RecentEventCount(ctx, today, "prompt", 0)
	sources = append(sources, SourceStatus{
		Name:        "Claude Code",
		Type:        "llm",
		Status:      claudeStatus,
		Detail:      claudeDetail,
		EventsToday: claudeEvents,
	})

	// Claude Projects (conversation logs)
	projectsPath := filepath.Join(home, ".claude", "projects")
	projectsStatus := "active"
	projectsDetail := projectsPath
	projectScanned := 0
	if c.claudeProjects != nil {
		projectScanned = len(c.claudeProjects.scanned)
	}
	if _, err := os.Stat(projectsPath); os.IsNotExist(err) {
		projectsStatus = "not_found"
		projectsDetail = "~/.claude/projects/ not found"
	} else {
		projectsDetail = fmt.Sprintf("%d conversation files scanned", projectScanned)
	}
	cpEvents, _ := c.db.RecentEventCount(ctx, today, "claude_user_msg", 0)
	sources = append(sources, SourceStatus{
		Name:        "Claude Projects",
		Type:        "llm",
		Status:      projectsStatus,
		Detail:      projectsDetail,
		EventsToday: cpEvents,
	})

	// Zed AI Threads
	zedPath := filepath.Join(home, "Library", "Application Support", "Zed", "threads", "threads.db")
	zedStatus := "active"
	zedDetail := ""
	zedThreads := 0
	if c.zed != nil {
		zedThreads = len(c.zed.knownIDs)
	}
	if _, err := os.Stat(zedPath); os.IsNotExist(err) {
		zedStatus = "not_found"
		zedDetail = "Zed threads.db not found"
	} else {
		zedDetail = fmt.Sprintf("%d threads tracked", zedThreads)
	}
	zedEvents, _ := c.db.RecentEventCount(ctx, today, "zed_thread_start", 0)
	zedUpdates, _ := c.db.RecentEventCount(ctx, today, "zed_thread_update", 0)
	sources = append(sources, SourceStatus{
		Name:        "Zed AI",
		Type:        "llm",
		Status:      zedStatus,
		Detail:      zedDetail,
		EventsToday: zedEvents + zedUpdates,
	})

	// Idle Detector
	idleEvents, _ := c.db.RecentEventCount(ctx, today, "idle_start", 0)
	sources = append(sources, SourceStatus{
		Name:        "Idle Detector",
		Type:        "idle",
		Status:      "active",
		Detail:      "5 min threshold",
		EventsToday: idleEvents,
	})

	// Aggregator
	bucketCount := 0
	buckets, _ := c.db.BucketsByDay(ctx, today)
	bucketCount = len(buckets)
	sources = append(sources, SourceStatus{
		Name:        "Aggregator",
		Type:        "aggregator",
		Status:      "active",
		Detail:      fmt.Sprintf("%d buckets today, 10 min interval", bucketCount),
		EventsToday: bucketCount,
	})

	return sources
}
