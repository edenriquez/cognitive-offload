package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.CutoffHour <= 0 {
		t.Errorf("CutoffHour should be > 0, got %f", cfg.CutoffHour)
	}
	if len(cfg.WatchPaths) == 0 {
		t.Error("WatchPaths should not be empty")
	}
	if cfg.DisabledRules == nil {
		t.Error("DisabledRules should not be nil")
	}
	if len(cfg.DisabledRules) != 0 {
		t.Errorf("DisabledRules should be empty slice, got %v", cfg.DisabledRules)
	}
	if cfg.MaxWatchDirs <= 0 {
		t.Errorf("MaxWatchDirs should be > 0, got %d", cfg.MaxWatchDirs)
	}
	if len(cfg.IgnoreDirs) == 0 {
		t.Error("IgnoreDirs should contain default entries")
	}
	if cfg.LunchStart <= 0 {
		t.Errorf("LunchStart should be > 0, got %f", cfg.LunchStart)
	}
	if cfg.LunchEnd <= cfg.LunchStart {
		t.Errorf("LunchEnd (%f) should be > LunchStart (%f)", cfg.LunchEnd, cfg.LunchStart)
	}
}

func TestDefaultConfig_SaneValues(t *testing.T) {
	cfg := DefaultConfig()

	t.Run("CutoffHour in reasonable range", func(t *testing.T) {
		if cfg.CutoffHour < 14 || cfg.CutoffHour > 22 {
			t.Errorf("CutoffHour %f is outside reasonable range [14, 22]", cfg.CutoffHour)
		}
	})

	t.Run("MaxWatchDirs has reasonable limit", func(t *testing.T) {
		if cfg.MaxWatchDirs < 100 || cfg.MaxWatchDirs > 10000 {
			t.Errorf("MaxWatchDirs %d is outside reasonable range [100, 10000]", cfg.MaxWatchDirs)
		}
	})
}

// setTestHome overrides HOME to a temp directory so that Load/Save use an
// isolated filesystem location. It returns a cleanup function.
func setTestHome(t *testing.T) string {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	return tmp
}

func TestLoadSaveRoundtrip(t *testing.T) {
	home := setTestHome(t)

	original := Config{
		WatchPaths:    []string{"/tmp/project-a", "/tmp/project-b"},
		IgnoreDirs:    []string{"node_modules", ".git"},
		MaxWatchDirs:  250,
		CutoffHour:    18.0,
		LunchStart:    12.0,
		LunchEnd:      13.0,
		DisabledRules: []string{"LOAD.FATIGUE", "CUTOFF.PAST"},
	}

	Save(original)

	// Verify the file was written
	path := filepath.Join(home, ".cogload", "config.json")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatalf("config file was not created at %s", path)
	}

	loaded := Load()

	if len(loaded.WatchPaths) != len(original.WatchPaths) {
		t.Fatalf("WatchPaths length mismatch: got %d, want %d", len(loaded.WatchPaths), len(original.WatchPaths))
	}
	for i, wp := range loaded.WatchPaths {
		if wp != original.WatchPaths[i] {
			t.Errorf("WatchPaths[%d] = %q, want %q", i, wp, original.WatchPaths[i])
		}
	}
	if loaded.CutoffHour != original.CutoffHour {
		t.Errorf("CutoffHour = %f, want %f", loaded.CutoffHour, original.CutoffHour)
	}
	if loaded.MaxWatchDirs != original.MaxWatchDirs {
		t.Errorf("MaxWatchDirs = %d, want %d", loaded.MaxWatchDirs, original.MaxWatchDirs)
	}
	if loaded.LunchStart != original.LunchStart {
		t.Errorf("LunchStart = %f, want %f", loaded.LunchStart, original.LunchStart)
	}
	if loaded.LunchEnd != original.LunchEnd {
		t.Errorf("LunchEnd = %f, want %f", loaded.LunchEnd, original.LunchEnd)
	}
	if len(loaded.DisabledRules) != len(original.DisabledRules) {
		t.Fatalf("DisabledRules length mismatch: got %d, want %d", len(loaded.DisabledRules), len(original.DisabledRules))
	}
	for i, r := range loaded.DisabledRules {
		if r != original.DisabledRules[i] {
			t.Errorf("DisabledRules[%d] = %q, want %q", i, r, original.DisabledRules[i])
		}
	}
}

func TestLoadMissingFile(t *testing.T) {
	setTestHome(t)

	cfg := Load()

	// Should return defaults
	if cfg.CutoffHour <= 0 {
		t.Errorf("CutoffHour should be > 0, got %f", cfg.CutoffHour)
	}
	if len(cfg.WatchPaths) == 0 {
		t.Error("WatchPaths should not be empty")
	}
	if len(cfg.DisabledRules) != 0 {
		t.Errorf("DisabledRules should be empty, got %v", cfg.DisabledRules)
	}
}

func TestLoadCorruptFile(t *testing.T) {
	home := setTestHome(t)

	dir := filepath.Join(home, ".cogload")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte("{invalid json!!!"), 0644); err != nil {
		t.Fatal(err)
	}

	cfg := Load()

	// Should fall back to defaults
	defaults := DefaultConfig()
	if cfg.CutoffHour != defaults.CutoffHour {
		t.Errorf("corrupt config should return default CutoffHour %f, got %f", defaults.CutoffHour, cfg.CutoffHour)
	}
}

func TestSaveCreatesDirectory(t *testing.T) {
	home := setTestHome(t)

	cfg := DefaultConfig()
	Save(cfg)

	dir := filepath.Join(home, ".cogload")
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("expected directory %s to exist: %v", dir, err)
	}
	if !info.IsDir() {
		t.Errorf("expected %s to be a directory", dir)
	}
}

func TestConfigJSONRoundtrip(t *testing.T) {
	original := Config{
		WatchPaths:    []string{"/a", "/b"},
		IgnoreDirs:    []string{"vendor"},
		MaxWatchDirs:  100,
		CutoffHour:    17.5,
		LunchStart:    12.0,
		LunchEnd:      13.0,
		DisabledRules: []string{"LOAD.STUCK"},
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded Config
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.CutoffHour != original.CutoffHour {
		t.Errorf("CutoffHour = %f, want %f", decoded.CutoffHour, original.CutoffHour)
	}
	if len(decoded.WatchPaths) != len(original.WatchPaths) {
		t.Errorf("WatchPaths length = %d, want %d", len(decoded.WatchPaths), len(original.WatchPaths))
	}
	if len(decoded.DisabledRules) != len(original.DisabledRules) {
		t.Errorf("DisabledRules length = %d, want %d", len(decoded.DisabledRules), len(original.DisabledRules))
	}
}

func TestLoadSanitizesMaxWatchDirs(t *testing.T) {
	home := setTestHome(t)

	cfg := Config{
		WatchPaths:    []string{"/tmp"},
		MaxWatchDirs:  -1, // invalid
		CutoffHour:    16.5,
		DisabledRules: []string{},
	}

	// Write directly so we don't rely on Save sanitizing
	dir := filepath.Join(home, ".cogload")
	os.MkdirAll(dir, 0755)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(filepath.Join(dir, "config.json"), data, 0644)

	loaded := Load()

	if loaded.MaxWatchDirs <= 0 {
		t.Errorf("Load should sanitize MaxWatchDirs <= 0, got %d", loaded.MaxWatchDirs)
	}
}
