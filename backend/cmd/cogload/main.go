package main

import (
	"context"
	"flag"
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

	router := api.NewRouter(db, hub, eng)

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
