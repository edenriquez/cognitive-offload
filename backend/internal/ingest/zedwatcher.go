package ingest

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type ZedWatcher struct {
	db         *store.DB
	dbPath     string
	lastCheck  time.Time
	knownIDs   map[string]string // thread ID → last updated_at
	stopCh     chan struct{}
	onActivity func()
}

func NewZedWatcher(db *store.DB, onActivity func()) *ZedWatcher {
	home, _ := os.UserHomeDir()
	return &ZedWatcher{
		db:         db,
		dbPath:     filepath.Join(home, "Library", "Application Support", "Zed", "threads", "threads.db"),
		knownIDs:   make(map[string]string),
		stopCh:     make(chan struct{}),
		onActivity: onActivity,
	}
}

func (z *ZedWatcher) Start(ctx context.Context) {
	// Check if Zed threads DB exists
	if _, err := os.Stat(z.dbPath); os.IsNotExist(err) {
		slog.Info("zed threads.db not found, skipping zed watcher", "path", z.dbPath)
		return
	}

	// Load existing thread IDs so we don't re-import on first run
	z.loadExisting()

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-z.stopCh:
				return
			case <-ticker.C:
				z.poll(ctx)
			}
		}
	}()

	slog.Info("zed watcher started", "db", z.dbPath, "known_threads", len(z.knownIDs))
}

func (z *ZedWatcher) Stop() {
	close(z.stopCh)
}

func (z *ZedWatcher) loadExisting() {
	zdb, err := sql.Open("sqlite3", z.dbPath+"?mode=ro&_journal_mode=WAL")
	if err != nil {
		slog.Error("zed watcher: failed to open db", "error", err)
		return
	}
	defer zdb.Close()

	rows, err := zdb.Query("SELECT id, updated_at FROM threads")
	if err != nil {
		slog.Error("zed watcher: failed to query threads", "error", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, updatedAt string
		if err := rows.Scan(&id, &updatedAt); err != nil {
			continue
		}
		z.knownIDs[id] = updatedAt
	}
}

func (z *ZedWatcher) poll(ctx context.Context) {
	zdb, err := sql.Open("sqlite3", z.dbPath+"?mode=ro&_journal_mode=WAL")
	if err != nil {
		return
	}
	defer zdb.Close()

	rows, err := zdb.Query(
		"SELECT id, summary, created_at, updated_at, folder_paths FROM threads ORDER BY updated_at DESC LIMIT 50")
	if err != nil {
		slog.Debug("zed watcher poll failed", "error", err)
		return
	}
	defer rows.Close()

	now := time.Now()
	day := now.Format("2006-01-02")
	var events []models.RawEvent

	for rows.Next() {
		var id, summary, updatedAt string
		var createdAt, folderPaths sql.NullString
		if err := rows.Scan(&id, &summary, &createdAt, &updatedAt, &folderPaths); err != nil {
			continue
		}

		prevUpdated, known := z.knownIDs[id]

		if !known {
			// Only create sessions for threads created today
			threadDay := ""
			if createdAt.Valid {
				if t, err := time.Parse(time.RFC3339Nano, createdAt.String); err == nil {
					threadDay = t.Format("2006-01-02")
				}
			}

			// Always track the ID so we detect updates, but only create events/sessions for today
			if threadDay == day {
				events = append(events, models.RawEvent{
					Timestamp: now,
					Source:    "llm",
					Kind:      "zed_thread_start",
					Day:       day,
					Metadata: map[string]any{
						"thread_id":    id,
						"summary":      truncate(summary, 200),
						"folder_paths": folderPaths.String,
					},
				})

				startedAt := now
				if createdAt.Valid {
					if t, err := time.Parse(time.RFC3339Nano, createdAt.String); err == nil {
						startedAt = t
					}
				}
				session := models.Session{
					ID:        "zed-" + id,
					Label:     "Zed: " + truncate(summary, 60),
					StartedAt: startedAt,
					Status:    "open",
					Day:       day,
				}
				z.db.UpsertSession(ctx, session)

				if z.onActivity != nil {
					z.onActivity()
				}

				slog.Debug("zed new thread", "summary", truncate(summary, 50))
			}

		} else if updatedAt != prevUpdated {
			// Only track updates for threads active today
			threadUpdatedDay := ""
			if t, err := time.Parse(time.RFC3339Nano, updatedAt); err == nil {
				threadUpdatedDay = t.Format("2006-01-02")
			}

			if threadUpdatedDay == day {
				events = append(events, models.RawEvent{
					Timestamp: now,
					Source:    "llm",
					Kind:      "zed_thread_update",
					Day:       day,
					Metadata: map[string]any{
						"thread_id": id,
						"summary":   truncate(summary, 200),
					},
				})

				// Increment session message count
				z.db.IncrementSessionMessages(ctx, "zed-"+id)

				if z.onActivity != nil {
					z.onActivity()
				}

				slog.Debug("zed thread updated", "summary", truncate(summary, 50))
			}
		}

		z.knownIDs[id] = updatedAt
	}

	if len(events) > 0 {
		if err := z.db.InsertEvents(ctx, events); err != nil {
			slog.Error("zed watcher insert failed", "error", err)
		}
	}
}
