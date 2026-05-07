package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cogload/backend/internal/api"
	"github.com/cogload/backend/internal/config"
	"github.com/cogload/backend/internal/engine"
	"github.com/cogload/backend/internal/ingest"
	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
	"github.com/cogload/backend/internal/ws"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	reset := flag.Bool("reset", false, "Delete all data and start fresh")
	flag.Parse()

	dbPath := os.Getenv("COGLOAD_DB")
	if dbPath == "" {
		home, _ := os.UserHomeDir()
		dbPath = home + "/.cogload/cogload.db"
	}

	if err := os.MkdirAll(dbPath[:len(dbPath)-len("/cogload.db")], 0755); err != nil {
		slog.Error("failed to create data directory", "error", err)
		os.Exit(1)
	}

	if *reset {
		slog.Info("resetting database", "path", dbPath)
		os.Remove(dbPath)
		os.Remove(dbPath + "-wal")
		os.Remove(dbPath + "-shm")
		slog.Info("database reset complete")
	}

	db, err := store.Open(dbPath)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Migrate(); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	hub := ws.NewHub()
	go hub.Run()

	eng := engine.New(db)

	// Load config
	cfg := config.Load()
	slog.Info("config loaded", "watch_paths", cfg.WatchPaths, "ignore_dirs", len(cfg.IgnoreDirs))

	// Start all data collectors via coordinator
	ctx, ctxCancel := context.WithCancel(context.Background())
	defer ctxCancel()

	coord, err := ingest.NewCoordinator(db, cfg)
	if err != nil {
		slog.Error("failed to create coordinator", "error", err)
	} else {
		if err := coord.Start(ctx); err != nil {
			slog.Error("failed to start coordinator", "error", err)
		}
		defer coord.Stop()
	}

	router := api.NewRouter(db, hub, eng, coord)

	addr := os.Getenv("COGLOAD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:9200"
	}

	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Midnight rollover — auto-roll locked plans at midnight
	go func() {
		for {
			now := time.Now()
			nextMidnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 5, 0, now.Location())
			sleepDur := nextMidnight.Sub(now)
			slog.Info("midnight rollover scheduled", "in", sleepDur.Round(time.Minute))

			select {
			case <-ctx.Done():
				return
			case <-time.After(sleepDur):
			}

			// It's midnight — check for a locked plan for today
			todayStr := time.Now().Format("2006-01-02")
			plan, err := db.PlanByDay(ctx, todayStr)
			if err != nil || plan == nil {
				slog.Debug("midnight rollover: no plan for today")
				continue
			}
			if plan.Status != "locked" {
				slog.Debug("midnight rollover: plan not locked, skipping")
				continue
			}

			// Roll tasks into today's task table
			created := 0
			for _, t := range plan.Tasks {
				newTask := models.Task{
					ID:   fmt.Sprintf("t-roll-%d-%d", time.Now().UnixNano(), created),
					Day:  todayStr,
					Kind: t.Kind,
					Idx:  t.Idx,
					Text: t.Text,
					Done: false,
				}
				if err := db.CreateTask(ctx, newTask); err != nil {
					continue
				}
				created++
			}

			plan.Status = "completed"
			db.UpsertPlan(ctx, *plan)
			slog.Info("midnight rollover complete", "day", todayStr, "tasks_created", created)
		}
	}()

	// Start signal broadcast ticker
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			snapshot, err := eng.SignalSnapshot(ctx)
			if err != nil {
				slog.Error("signal snapshot failed", "error", err)
				continue
			}
			hub.Broadcast(snapshot)
		}
	}()

	go func() {
		slog.Info("cogload server starting", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
