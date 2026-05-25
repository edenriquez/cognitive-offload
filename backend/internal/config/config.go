package config

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/cogload/backend/internal/models"
)

type Config struct {
	WatchPaths    []string            `json:"watch_paths"`
	IgnoreDirs    []string            `json:"ignore_dirs"`
	MaxWatchDirs  int                 `json:"max_watch_dirs"`
	CutoffHour    float64             `json:"cutoff_hour"`
	LunchStart    float64             `json:"lunch_start"`
	LunchEnd      float64             `json:"lunch_end"`
	DisabledRules []string            `json:"disabled_rules"`
	AnthropicKey  string              `json:"anthropic_key,omitempty"`
	BlockConfig   *models.BlockConfig `json:"block_config,omitempty"`
}

func DefaultConfig() Config {
	// Default: watch the current working directory, not all of ~/dev
	cwd, err := os.Getwd()
	if err != nil {
		home, _ := os.UserHomeDir()
		cwd = home
	}

	return Config{
		WatchPaths: []string{cwd},
		IgnoreDirs: []string{
			"node_modules", ".git", "target", "dist", "build",
			".next", "__pycache__", ".venv", "vendor", ".cache",
			".turbo", ".nuxt", ".output", ".svelte-kit",
			"coverage", ".nyc_output", "tmp", "temp",
		},
		MaxWatchDirs:  500,
		CutoffHour:    16.5,
		LunchStart:    12.5,
		LunchEnd:      13.5,
		DisabledRules: []string{},
	}
}

func Load() Config {
	cfg := DefaultConfig()

	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".cogload", "config.json")

	data, err := os.ReadFile(path)
	if err != nil {
		Save(cfg)
		return cfg
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		slog.Warn("failed to parse config, using defaults", "error", err)
		return DefaultConfig()
	}

	// Ensure sane limits
	if cfg.MaxWatchDirs <= 0 {
		cfg.MaxWatchDirs = 500
	}

	// Hydrate API key into environment if set in config but not in env
	if cfg.AnthropicKey != "" && os.Getenv("ANTHROPIC_API_KEY") == "" {
		os.Setenv("ANTHROPIC_API_KEY", cfg.AnthropicKey)
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
