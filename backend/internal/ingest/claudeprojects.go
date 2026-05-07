package ingest

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type conversationMessage struct {
	Type       string `json:"type"`
	ParentUUID string `json:"parentUuid"`
	UUID       string `json:"uuid"`
	Timestamp  string `json:"timestamp"`
	SessionID  string `json:"sessionId"`
	CWD        string `json:"cwd"`
	GitBranch  string `json:"gitBranch"`
	Message    *struct {
		Role    string `json:"role"`
		Content any    `json:"content"`
	} `json:"message"`
}

type ClaudeProjectScanner struct {
	db      *store.DB
	baseDir string
	stopCh  chan struct{}
	scanned map[string]int64 // file path → last scanned size
}

func NewClaudeProjectScanner(db *store.DB) *ClaudeProjectScanner {
	home, _ := os.UserHomeDir()
	return &ClaudeProjectScanner{
		db:      db,
		baseDir: filepath.Join(home, ".claude", "projects"),
		stopCh:  make(chan struct{}),
		scanned: make(map[string]int64),
	}
}

func (c *ClaudeProjectScanner) Start(ctx context.Context) {
	if _, err := os.Stat(c.baseDir); os.IsNotExist(err) {
		slog.Info("claude projects dir not found, skipping scanner", "path", c.baseDir)
		return
	}

	// Initial scan
	c.scan(ctx)

	go func() {
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-c.stopCh:
				return
			case <-ticker.C:
				c.scan(ctx)
			}
		}
	}()

	slog.Info("claude project scanner started", "dir", c.baseDir)
}

func (c *ClaudeProjectScanner) Stop() {
	close(c.stopCh)
}

func (c *ClaudeProjectScanner) scan(ctx context.Context) {
	entries, err := os.ReadDir(c.baseDir)
	if err != nil {
		return
	}

	for _, projectDir := range entries {
		if !projectDir.IsDir() {
			continue
		}
		projectPath := filepath.Join(c.baseDir, projectDir.Name())
		c.scanProject(ctx, projectPath, projectDir.Name())
	}
}

func (c *ClaudeProjectScanner) scanProject(ctx context.Context, projectPath, projectName string) {
	files, err := os.ReadDir(projectPath)
	if err != nil {
		return
	}

	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
			continue
		}
		filePath := filepath.Join(projectPath, f.Name())
		info, err := os.Stat(filePath)
		if err != nil {
			continue
		}

		lastSize := c.scanned[filePath]
		currentSize := info.Size()
		if currentSize <= lastSize {
			continue // No new data
		}

		c.parseConversation(ctx, filePath, lastSize, projectName)
		c.scanned[filePath] = currentSize
	}
}

func (c *ClaudeProjectScanner) parseConversation(ctx context.Context, filePath string, offset int64, projectName string) {
	f, err := os.Open(filePath)
	if err != nil {
		return
	}
	defer f.Close()

	if offset > 0 {
		f.Seek(offset, 0)
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB line buffer

	now := time.Now()
	day := now.Format("2006-01-02")
	var events []models.RawEvent

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) < 2 {
			continue
		}

		var msg conversationMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "user":
			if msg.Message != nil && msg.Message.Role == "user" {
				events = append(events, models.RawEvent{
					Timestamp: parseTimestamp(msg.Timestamp, now),
					Source:    "llm",
					Kind:      "claude_user_msg",
					Day:       day,
					Metadata: map[string]any{
						"session_id": msg.SessionID,
						"project":    projectName,
						"branch":     msg.GitBranch,
						"cwd":        msg.CWD,
					},
				})
			}

		case "assistant":
			if msg.Message != nil && msg.Message.Role == "assistant" {
				events = append(events, models.RawEvent{
					Timestamp: parseTimestamp(msg.Timestamp, now),
					Source:    "llm",
					Kind:      "claude_assistant_msg",
					Day:       day,
					Metadata: map[string]any{
						"session_id": msg.SessionID,
						"project":    projectName,
					},
				})
			}

		case "tool_use":
			events = append(events, models.RawEvent{
				Timestamp: parseTimestamp(msg.Timestamp, now),
				Source:    "llm",
				Kind:      "claude_tool_use",
				Day:       day,
				Metadata: map[string]any{
					"session_id": msg.SessionID,
					"project":    projectName,
				},
			})
		}

		// Only create/update sessions for today's messages
		if msg.SessionID != "" && day == now.Format("2006-01-02") {
			msgTime := parseTimestamp(msg.Timestamp, now)
			msgDay := msgTime.Format("2006-01-02")
			if msgDay == day {
				session := models.Session{
					ID:        msg.SessionID,
					Label:     "Claude: " + decodePath(projectName),
					StartedAt: parseTimestamp(msg.Timestamp, now),
					Status:    "open",
					Day:       day,
				}
				c.db.UpsertSession(ctx, session)
			}
		}
	}

	if len(events) > 0 {
		if err := c.db.InsertEvents(ctx, events); err != nil {
			slog.Error("claude project scanner insert failed", "error", err, "count", len(events))
		} else {
			slog.Debug("claude project scanner", "file", filepath.Base(filePath), "events", len(events))
		}
	}
}

func parseTimestamp(ts string, fallback time.Time) time.Time {
	if ts == "" {
		return fallback
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		t, err = time.Parse(time.RFC3339, ts)
		if err != nil {
			return fallback
		}
	}
	return t
}

func decodePath(encoded string) string {
	// Claude encodes paths like "-Users-eduardoenriquez-dev-myproject"
	s := strings.ReplaceAll(encoded, "-", "/")
	if strings.HasPrefix(s, "/") {
		return s
	}
	return "/" + s
}
