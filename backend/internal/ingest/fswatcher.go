package ingest

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type FSWatcher struct {
	db           *store.DB
	paths        []string
	ignoreDirs   map[string]bool
	maxDirs      int
	watcher      *fsnotify.Watcher
	watchedCount atomic.Int32

	mu     sync.Mutex
	batch  []models.RawEvent
	stopCh chan struct{}
}

func NewFSWatcher(db *store.DB, watchPaths []string, ignoreDirs []string, maxDirs int) (*FSWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	ignore := make(map[string]bool)
	for _, d := range ignoreDirs {
		ignore[d] = true
	}

	if maxDirs <= 0 {
		maxDirs = 500
	}

	return &FSWatcher{
		db:         db,
		paths:      watchPaths,
		ignoreDirs: ignore,
		maxDirs:    maxDirs,
		watcher:    w,
		stopCh:     make(chan struct{}),
	}, nil
}

func (f *FSWatcher) Start(ctx context.Context) error {
	for _, root := range f.paths {
		if err := f.addRecursive(root); err != nil {
			slog.Warn("failed to watch path", "path", root, "error", err)
		}
	}

	go f.flushLoop(ctx)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-f.stopCh:
				return
			case event, ok := <-f.watcher.Events:
				if !ok {
					return
				}
				f.handleEvent(event)
			case err, ok := <-f.watcher.Errors:
				if !ok {
					return
				}
				slog.Debug("fswatcher error", "error", err)
			}
		}
	}()

	count := f.watchedCount.Load()
	slog.Info("file watcher started", "directories", count, "max", f.maxDirs, "roots", f.paths)
	return nil
}

func (f *FSWatcher) Stop() {
	close(f.stopCh)
	f.watcher.Close()
	f.flush(context.Background())
}

func (f *FSWatcher) handleEvent(event fsnotify.Event) {
	if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
		if event.Has(fsnotify.Create) && !f.shouldIgnore(event.Name) {
			f.addRecursive(event.Name)
		}
		return
	}

	var kind string
	switch {
	case event.Has(fsnotify.Write):
		kind = "file_save"
	case event.Has(fsnotify.Create):
		kind = "file_create"
	case event.Has(fsnotify.Remove):
		kind = "file_delete"
	case event.Has(fsnotify.Rename):
		kind = "file_rename"
	default:
		return
	}

	now := time.Now()
	ext := filepath.Ext(event.Name)
	dir := filepath.Dir(event.Name)

	ev := models.RawEvent{
		Timestamp: now,
		Source:    "editor",
		Kind:      kind,
		Day:       now.Format("2006-01-02"),
		Metadata: map[string]any{
			"file": event.Name,
			"ext":  ext,
			"dir":  dir,
		},
	}

	f.mu.Lock()
	f.batch = append(f.batch, ev)
	f.mu.Unlock()
}

func (f *FSWatcher) flushLoop(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-f.stopCh:
			return
		case <-ticker.C:
			f.flush(ctx)
		}
	}
}

func (f *FSWatcher) flush(ctx context.Context) {
	f.mu.Lock()
	if len(f.batch) == 0 {
		f.mu.Unlock()
		return
	}
	events := f.batch
	f.batch = nil
	f.mu.Unlock()

	if err := f.db.InsertEvents(ctx, events); err != nil {
		slog.Error("fswatcher flush failed", "error", err, "count", len(events))
		return
	}
	slog.Debug("fswatcher flushed", "events", len(events))
}

func (f *FSWatcher) addRecursive(root string) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return filepath.SkipDir
		}
		if !d.IsDir() {
			return nil
		}
		if f.shouldIgnore(path) {
			return filepath.SkipDir
		}
		// Respect max directory limit
		if int(f.watchedCount.Load()) >= f.maxDirs {
			return filepath.SkipDir
		}
		if err := f.watcher.Add(path); err != nil {
			slog.Debug("fswatcher skip dir", "path", path, "error", err)
			return filepath.SkipDir
		}
		f.watchedCount.Add(1)
		return nil
	})
}

func (f *FSWatcher) shouldIgnore(path string) bool {
	parts := strings.Split(path, string(os.PathSeparator))
	for _, p := range parts {
		if f.ignoreDirs[p] {
			return true
		}
	}
	base := filepath.Base(path)
	if strings.HasPrefix(base, ".") && base != ".cogload" {
		return true
	}
	return false
}
