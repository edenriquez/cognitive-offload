package config

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
)

type Config struct {
	WatchPaths []string `json:"watch_paths"`
	IgnoreDirs []string `json:"ignore_dirs"`
	CutoffHour float64  `json:"cutoff_hour"`
	ThreadCap  int      `json:"thread_cap"`
}

func DefaultConfig() Config {
	home, _ := os.UserHomeDir()
	return Config{
		WatchPaths: []string{filepath.Join(home, "dev")},
		IgnoreDirs: []string{
			"node_modules", ".git", "target", "dist", "build",
			".next", "__pycache__", ".venv", "vendor", ".cache",
			".turbo", ".nuxt", ".output",
		},
		CutoffHour: 16.5,
		ThreadCap:  1,
	}
}

func Load() Config {
	cfg := DefaultConfig()

	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".cogload", "config.json")

	data, err := os.ReadFile(path)
	if err != nil {
		// No config file yet — write defaults
		Save(cfg)
		return cfg
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		slog.Warn("failed to parse config, using defaults", "error", err)
		return DefaultConfig()
	}
	return cfg
}

func Save(cfg Config) {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".cogload")
	os.MkdirAll(dir, 0755)

	data, _ := json.MarshalIndent(cfg, "", "  ")
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		slog.Error("failed to save config", "error", err)
	}
}
