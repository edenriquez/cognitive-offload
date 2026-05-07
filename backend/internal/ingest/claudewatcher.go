package ingest

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type historyEntry struct {
	Display   string `json:"display"`
	Timestamp int64  `json:"timestamp"`
	Project   string `json:"project"`
	SessionID string `json:"sessionId"`
}

type ClaudeWatcher struct {
	db       *store.DB
	filePath string
	stopCh   chan struct{}
	// Callback to notify idle detector of activity
	onActivity func()
}

func NewClaudeWatcher(db *store.DB, onActivity func()) *ClaudeWatcher {
	home, _ := os.UserHomeDir()
	return &ClaudeWatcher{
		db:         db,
		filePath:   filepath.Join(home, ".claude", "history.jsonl"),
		stopCh:     make(chan struct{}),
		onActivity: onActivity,
	}
}

func (c *ClaudeWatcher) Start(ctx context.Context) {
	go func() {
		if err := c.tailFile(ctx); err != nil {
			slog.Error("claude watcher stopped", "error", err)
		}
	}()
	slog.Info("claude watcher started", "file", c.filePath)
}

func (c *ClaudeWatcher) Stop() {
	close(c.stopCh)
}

func (c *ClaudeWatcher) tailFile(ctx context.Context) error {
	f, err := os.Open(c.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Info("claude history file not found, waiting", "path", c.filePath)
			return c.waitForFile(ctx)
		}
		return err
	}
	defer f.Close()

	// Backfill: scan entire file for today's entries
	today := time.Now().Format("2006-01-02")
	backfilled := 0
	seenSessions := make(map[string]bool)
	var lastSessionID string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) < 2 {
			continue
		}
		var entry historyEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		if entry.SessionID == "" || entry.Timestamp == 0 {
			continue
		}
		// Only backfill today's entries
		ts := time.UnixMilli(entry.Timestamp)
		if ts.Format("2006-01-02") == today {
			// Close previous session when a new one starts
			if lastSessionID != "" && entry.SessionID != lastSessionID {
				c.db.CloseSession(ctx, lastSessionID)
			}
			lastSessionID = entry.SessionID
			seenSessions[entry.SessionID] = true
			c.processEntry(ctx, entry)
			backfilled++
		}
	}
	// Close all sessions except the most recent one
	for sid := range seenSessions {
		if sid != lastSessionID {
			c.db.CloseSession(ctx, sid)
		}
	}
	if backfilled > 0 {
		slog.Info("claude watcher backfilled today's history", "entries", backfilled, "sessions", len(seenSessions))
	}

	// Now tail for new entries
	reader := bufio.NewReader(f)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-c.stopCh:
			return nil
		case <-ticker.C:
			c.readNewLines(ctx, reader)
		}
	}
}

func (c *ClaudeWatcher) waitForFile(ctx context.Context) error {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-c.stopCh:
			return nil
		case <-ticker.C:
			if _, err := os.Stat(c.filePath); err == nil {
				slog.Info("claude history file appeared", "path", c.filePath)
				return c.tailFile(ctx)
			}
		}
	}
}

func (c *ClaudeWatcher) readNewLines(ctx context.Context, reader *bufio.Reader) {
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return // No more data — wait for next tick
		}
		if len(line) <= 1 {
			continue
		}

		var entry historyEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		if entry.SessionID == "" || entry.Timestamp == 0 {
			continue
		}

		c.processEntry(ctx, entry)
	}
}

func (c *ClaudeWatcher) processEntry(ctx context.Context, entry historyEntry) {
	now := time.Now()
	day := now.Format("2006-01-02")

	// Notify idle detector
	if c.onActivity != nil {
		c.onActivity()
	}

	// Convert timestamp (milliseconds)
	ts := time.UnixMilli(entry.Timestamp)

	// Insert as raw event
	event := models.RawEvent{
		Timestamp: ts,
		Source:    "llm",
		Kind:      "prompt",
		Day:       day,
		Metadata: map[string]any{
			"session_id": entry.SessionID,
			"project":    entry.Project,
			"display":    truncate(entry.Display, 200),
		},
	}
	if err := c.db.InsertEvents(ctx, []models.RawEvent{event}); err != nil {
		slog.Error("claude watcher insert event failed", "error", err)
	}

	// Upsert session — increment message count
	session := models.Session{
		ID:        entry.SessionID,
		Label:     truncate(entry.Display, 80),
		StartedAt: ts,
		Status:    "open",
		Day:       day,
	}
	if err := c.db.UpsertSession(ctx, session); err != nil {
		slog.Error("claude watcher upsert session failed", "error", err)
	}

	// Increment message count separately
	c.db.IncrementSessionMessages(ctx, entry.SessionID)

	slog.Debug("claude prompt captured", "session", entry.SessionID[:8], "project", filepath.Base(entry.Project))
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}
