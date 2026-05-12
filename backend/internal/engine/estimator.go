package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// CognitiveBudgetConfig holds tunable parameters for estimation.
type CognitiveBudgetConfig struct {
	// MaxMinutesBeforeSplit — tasks above this trigger auto-split suggestion
	MaxMinutesBeforeSplit int
	// WeightScope — multiplier for scope dimension
	WeightScope float64
	// WeightNovelty — multiplier for novelty dimension
	WeightNovelty float64
	// WeightDependencies — multiplier for dependencies dimension
	WeightDependencies float64
	// WeightAmbiguity — multiplier for ambiguity dimension
	WeightAmbiguity float64
	// WeightPriorWork — multiplier for prior work (inverse — more prior work = easier)
	WeightPriorWork float64
	// WeightErrorRisk — multiplier for error risk
	WeightErrorRisk float64
	// WeightCognitiveSwitch — multiplier for context-switching cost
	WeightCognitiveSwitch float64
	// BaseMinutesPerPoint — base minutes per complexity point
	BaseMinutesPerPoint float64
}

// DefaultBudgetConfig returns sensible defaults for estimation weights.
func DefaultBudgetConfig() CognitiveBudgetConfig {
	return CognitiveBudgetConfig{
		MaxMinutesBeforeSplit: 90, // 90-minute focus blocks
		WeightScope:           1.5,
		WeightNovelty:         1.3,
		WeightDependencies:    1.2,
		WeightAmbiguity:       1.8, // Ambiguity is the biggest cost multiplier
		WeightPriorWork:       1.0,
		WeightErrorRisk:       1.1,
		WeightCognitiveSwitch: 1.4,
		BaseMinutesPerPoint:   3.0,
	}
}

// EstimateTask produces a cognitive budget estimate for a task.
func EstimateTask(ctx context.Context, db *store.DB, req models.EstimateRequest) (models.TaskEstimate, error) {
	cfg := DefaultBudgetConfig()
	now := time.Now()
	today := now.Format("2006-01-02")

	// Gather project context
	projectCtx := gatherProjectContext(ctx, db, req, today)

	// Try LLM estimation first
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey != "" {
		estimate, err := estimateWithLLM(ctx, req, projectCtx, cfg, apiKey)
		if err == nil {
			estimate.TaskID = req.TaskID
			estimate.TaskText = req.TaskText
			estimate.Source = "llm"
			estimate.CreatedAt = now
			// Persist estimate
			_ = db.InsertTaskEstimate(ctx, estimate)
			return estimate, nil
		}
		slog.Warn("LLM estimation failed, falling back to heuristic", "error", err)
	}

	// Heuristic estimation
	estimate := estimateHeuristic(req, projectCtx, cfg)
	estimate.TaskID = req.TaskID
	estimate.TaskText = req.TaskText
	estimate.Source = "heuristic"
	estimate.CreatedAt = now

	// Persist estimate
	_ = db.InsertTaskEstimate(ctx, estimate)
	return estimate, nil
}

// projectContext holds gathered information for estimation.
type projectContext struct {
	ProjectName     string
	TotalFiles      int
	RecentActivity  int // events in last 24h
	OpenSessions    int
	CompletedToday  int
	TotalTasksToday int
	PriorPatterns   []models.Pattern
	HasPriorWork    bool
	DirSummary      string // summary of relevant directories
	HistoricalAvg   int    // avg minutes per task historically
}

func gatherProjectContext(ctx context.Context, db *store.DB, req models.EstimateRequest, today string) projectContext {
	pc := projectContext{}

	// Tasks today
	tasks, _ := db.TasksByDay(ctx, today)
	pc.TotalTasksToday = len(tasks)
	for _, t := range tasks {
		if t.Done {
			pc.CompletedToday++
		}
	}

	// Open sessions (cognitive load indicator)
	sessions, _ := db.SessionsByDay(ctx, today)
	for _, s := range sessions {
		if s.Status == "open" || s.Status == "stalled" {
			pc.OpenSessions++
		}
	}

	// Recent patterns (last 3 days)
	for i := 0; i < 3; i++ {
		day := time.Now().AddDate(0, 0, -i).Format("2006-01-02")
		patterns, _ := db.PatternsByDay(ctx, day)
		pc.PriorPatterns = append(pc.PriorPatterns, patterns...)
	}

	// Historical task completion average
	focusSessions, _ := db.FocusSessionsByDay(ctx, today)
	if len(focusSessions) > 0 {
		totalMin := 0
		for _, fs := range focusSessions {
			totalMin += fs.DurationSec / 60
		}
		pc.HistoricalAvg = totalMin / len(focusSessions)
	}

	// Project directory analysis
	if req.ProjectPath != "" {
		pc.ProjectName = filepath.Base(req.ProjectPath)
		pc.DirSummary = scanProjectDirectory(req.ProjectPath)
		pc.HasPriorWork = true
	} else {
		// Check configured watch paths for project context
		projects, _ := db.ListProjects(ctx)
		if len(projects) > 0 {
			pc.ProjectName = projects[0].Name
			pc.DirSummary = scanProjectDirectory(projects[0].Path)
			pc.HasPriorWork = true
		}
	}

	return pc
}

// scanProjectDirectory produces a concise summary of a project directory.
func scanProjectDirectory(root string) string {
	if root == "" {
		return ""
	}

	var parts []string
	dirCount := 0
	fileCount := 0
	langCounts := map[string]int{}

	ignoreDirs := map[string]bool{
		"node_modules": true, ".git": true, "target": true, "dist": true,
		"build": true, ".next": true, "__pycache__": true, ".venv": true,
		"vendor": true, ".cache": true, "coverage": true, "tmp": true,
	}

	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if ignoreDirs[info.Name()] {
				return filepath.SkipDir
			}
			dirCount++
			if dirCount > 200 {
				return filepath.SkipDir
			}
			return nil
		}
		fileCount++
		ext := strings.ToLower(filepath.Ext(info.Name()))
		if ext != "" {
			langCounts[ext]++
		}
		return nil
	})

	parts = append(parts, fmt.Sprintf("%d dirs, %d files", dirCount, fileCount))

	// Top 5 languages by file count
	type langEntry struct {
		ext   string
		count int
	}
	var langs []langEntry
	for ext, count := range langCounts {
		langs = append(langs, langEntry{ext, count})
	}
	for i := 0; i < len(langs); i++ {
		for j := i + 1; j < len(langs); j++ {
			if langs[j].count > langs[i].count {
				langs[i], langs[j] = langs[j], langs[i]
			}
		}
	}
	if len(langs) > 5 {
		langs = langs[:5]
	}
	for _, l := range langs {
		parts = append(parts, fmt.Sprintf("%s:%d", l.ext, l.count))
	}

	return strings.Join(parts, ", ")
}

// estimateHeuristic uses parameterized scoring without LLM.
func estimateHeuristic(req models.EstimateRequest, pc projectContext, cfg CognitiveBudgetConfig) models.TaskEstimate {
	text := strings.ToLower(req.TaskText)

	// --- Score each dimension based on task text analysis ---
	matrix := models.ComplexityMatrix{}

	// Scope: keyword analysis
	matrix.Scope = 3
	if estContainsAny(text, []string{"refactor", "migration", "restructure", "overhaul", "rewrite"}) {
		matrix.Scope = 8
	} else if estContainsAny(text, []string{"full", "entire", "all", "complete", "end-to-end", "e2e"}) {
		matrix.Scope = 7
	} else if estContainsAny(text, []string{"add", "create", "new", "implement"}) {
		matrix.Scope = 5
	} else if estContainsAny(text, []string{"fix", "patch", "tweak", "adjust", "update"}) {
		matrix.Scope = 2
	}

	// Novelty
	matrix.Novelty = 4
	if estContainsAny(text, []string{"new framework", "new library", "new technology", "research", "explore", "investigate", "prototype"}) {
		matrix.Novelty = 8
	} else if estContainsAny(text, []string{"new feature", "new component", "new endpoint", "new api"}) {
		matrix.Novelty = 6
	} else if estContainsAny(text, []string{"fix", "bug", "patch", "update"}) {
		matrix.Novelty = 2
	}

	// Dependencies
	matrix.Dependencies = 3
	if estContainsAny(text, []string{"integrate", "api", "external", "third-party", "webhook", "oauth", "payment", "auth"}) {
		matrix.Dependencies = 7
	} else if estContainsAny(text, []string{"database", "migration", "schema", "deploy"}) {
		matrix.Dependencies = 6
	}

	// Ambiguity — shorter task descriptions are more ambiguous
	matrix.Ambiguity = 4
	wordCount := len(strings.Fields(req.TaskText))
	if wordCount <= 3 {
		matrix.Ambiguity = 8
	} else if wordCount <= 6 {
		matrix.Ambiguity = 5
	} else if wordCount >= 15 {
		matrix.Ambiguity = 2
	}
	if estContainsAny(text, []string{"somehow", "maybe", "figure out", "look into", "investigate"}) {
		matrix.Ambiguity = estMin(matrix.Ambiguity+3, 10)
	}

	// Prior work
	matrix.PriorWork = 3
	if pc.HasPriorWork {
		matrix.PriorWork = 7
	}
	if pc.HistoricalAvg > 0 {
		matrix.PriorWork = estMin(matrix.PriorWork+2, 10)
	}

	// Error risk
	matrix.ErrorRisk = 3
	if estContainsAny(text, []string{"refactor", "migration", "database", "deploy", "production", "auth", "security", "payment"}) {
		matrix.ErrorRisk = 7
	} else if estContainsAny(text, []string{"test", "lint", "format", "docs", "readme"}) {
		matrix.ErrorRisk = 1
	}

	// Cognitive switch cost
	matrix.CognitiveSwitch = 2
	if estContainsAny(text, []string{"frontend and backend", "full-stack", "fullstack", "end-to-end", "e2e", "cross-platform"}) {
		matrix.CognitiveSwitch = 8
	} else if estContainsAny(text, []string{"backend", "api", "database"}) && estContainsAny(text, []string{"ui", "frontend", "component"}) {
		matrix.CognitiveSwitch = 7
	}
	if pc.OpenSessions > 3 {
		matrix.CognitiveSwitch = estMin(matrix.CognitiveSwitch+2, 10)
	}

	// --- Compute weighted score ---
	weightedScore := float64(matrix.Scope)*cfg.WeightScope +
		float64(matrix.Novelty)*cfg.WeightNovelty +
		float64(matrix.Dependencies)*cfg.WeightDependencies +
		float64(matrix.Ambiguity)*cfg.WeightAmbiguity +
		float64(11-matrix.PriorWork)*cfg.WeightPriorWork + // Invert: more prior work = lower cost
		float64(matrix.ErrorRisk)*cfg.WeightErrorRisk +
		float64(matrix.CognitiveSwitch)*cfg.WeightCognitiveSwitch

	// Normalize to 0-100 cognitive load score
	maxWeighted := 10 * (cfg.WeightScope + cfg.WeightNovelty + cfg.WeightDependencies +
		cfg.WeightAmbiguity + cfg.WeightPriorWork + cfg.WeightErrorRisk + cfg.WeightCognitiveSwitch)
	cogLoad := int(math.Round(weightedScore / maxWeighted * 100))
	if cogLoad > 100 {
		cogLoad = 100
	}

	// Time estimate
	estimatedMin := int(math.Round(weightedScore * cfg.BaseMinutesPerPoint))
	if pc.OpenSessions > 2 {
		estimatedMin = int(float64(estimatedMin) * (1 + float64(pc.OpenSessions-2)*0.1))
	}
	if estimatedMin < 5 {
		estimatedMin = 5
	}

	// Complexity label
	complexity := "medium"
	switch {
	case cogLoad <= 15:
		complexity = "trivial"
	case cogLoad <= 30:
		complexity = "low"
	case cogLoad <= 55:
		complexity = "medium"
	case cogLoad <= 75:
		complexity = "high"
	default:
		complexity = "extreme"
	}

	// Should split?
	shouldSplit := estimatedMin > cfg.MaxMinutesBeforeSplit
	var splits []models.SuggestedTask
	if shouldSplit {
		splits = generateHeuristicSplits(req.TaskText, estimatedMin, cfg.MaxMinutesBeforeSplit, matrix)
	}

	// Confidence — heuristic mode caps at 75%
	confidence := 40
	if pc.HasPriorWork {
		confidence += 15
	}
	if pc.HistoricalAvg > 0 {
		confidence += 10
	}
	if wordCount >= 10 {
		confidence += 10
	}
	if confidence > 75 {
		confidence = 75
	}

	reasoning := fmt.Sprintf("Heuristic estimate based on task text analysis. "+
		"Key drivers: scope=%d, ambiguity=%d, novelty=%d. "+
		"Project context: %s.", matrix.Scope, matrix.Ambiguity, matrix.Novelty,
		summarizeEstContext(pc))

	return models.TaskEstimate{
		ID:              fmt.Sprintf("est-%d", time.Now().UnixMilli()),
		EstimatedMin:    estimatedMin,
		Complexity:      complexity,
		CognitiveLoad:   cogLoad,
		Confidence:      confidence,
		ShouldSplit:     shouldSplit,
		SuggestedSplits: splits,
		Reasoning:       reasoning,
		Matrix:          matrix,
	}
}

// generateHeuristicSplits creates meaningful phase-based sub-tasks without LLM.
// It analyzes the task text to produce splits with distinct scopes rather than
// generic prefixes.
func generateHeuristicSplits(taskText string, totalMin int, maxMin int, matrix models.ComplexityMatrix) []models.SuggestedTask {
	numParts := (totalMin + maxMin - 1) / maxMin
	if numParts < 2 {
		numParts = 2
	}
	if numParts > 5 {
		numParts = 5
	}

	text := strings.ToLower(taskText)

	// Pick a decomposition strategy based on what the task involves
	var phases []splitPhase

	switch {
	// High scope + high dependencies → architecture-first
	case matrix.Scope >= 6 && matrix.Dependencies >= 5:
		phases = []splitPhase{
			{verb: "Map dependencies and define interfaces for", pct: 15},
			{verb: "Set up scaffolding and data layer for", pct: 20},
			{verb: "Implement core logic for", pct: 30},
			{verb: "Connect components and handle edge cases for", pct: 20},
			{verb: "Write tests and verify", pct: 15},
		}
	// High novelty → research-first
	case matrix.Novelty >= 6:
		phases = []splitPhase{
			{verb: "Research approaches and prototype", pct: 25},
			{verb: "Implement chosen approach for", pct: 35},
			{verb: "Integrate and wire up", pct: 25},
			{verb: "Test and document", pct: 15},
		}
	// High ambiguity → clarify-first
	case matrix.Ambiguity >= 6:
		phases = []splitPhase{
			{verb: "Define requirements and acceptance criteria for", pct: 20},
			{verb: "Build minimal working version of", pct: 35},
			{verb: "Iterate and refine", pct: 30},
			{verb: "Verify and clean up", pct: 15},
		}
	// Contains "refactor" or "migrate"
	case estContainsAny(text, []string{"refactor", "migrate", "rewrite", "restructure"}):
		phases = []splitPhase{
			{verb: "Audit existing code and plan changes for", pct: 15},
			{verb: "Extract and restructure core of", pct: 30},
			{verb: "Update callers and fix breakages from", pct: 30},
			{verb: "Run full regression tests for", pct: 15},
			{verb: "Clean up and document", pct: 10},
		}
	// Contains "api" or "endpoint"
	case estContainsAny(text, []string{"api", "endpoint", "route", "backend"}):
		phases = []splitPhase{
			{verb: "Design API contract and models for", pct: 15},
			{verb: "Implement handler and business logic for", pct: 35},
			{verb: "Add validation, errors and edge cases for", pct: 25},
			{verb: "Write API tests for", pct: 15},
			{verb: "Document endpoints for", pct: 10},
		}
	// Contains "ui", "component", "frontend", "page"
	case estContainsAny(text, []string{"ui", "component", "frontend", "page", "screen", "view", "form"}):
		phases = []splitPhase{
			{verb: "Design layout and states for", pct: 15},
			{verb: "Build core component for", pct: 35},
			{verb: "Wire data and interactions for", pct: 30},
			{verb: "Polish styling and edge cases for", pct: 20},
		}
	// Contains "test"
	case estContainsAny(text, []string{"test", "testing", "coverage"}):
		phases = []splitPhase{
			{verb: "Identify test cases and set up fixtures for", pct: 20},
			{verb: "Write happy-path tests for", pct: 30},
			{verb: "Write edge case and error tests for", pct: 30},
			{verb: "Review coverage and fill gaps for", pct: 20},
		}
	// High cognitive switch → domain-split
	case matrix.CognitiveSwitch >= 6:
		phases = []splitPhase{
			{verb: "Implement backend/data layer for", pct: 35},
			{verb: "Implement frontend/UI for", pct: 35},
			{verb: "Integrate and test end-to-end", pct: 20},
			{verb: "Polish and handle errors for", pct: 10},
		}
	// Default: generic but with distinct scopes
	default:
		phases = []splitPhase{
			{verb: "Analyze and plan approach for", pct: 15},
			{verb: "Implement", pct: 40},
			{verb: "Test and verify", pct: 25},
			{verb: "Clean up and finalize", pct: 20},
		}
	}

	// Trim phases to numParts — take the ones with highest pct
	if len(phases) > numParts {
		phases = phases[:numParts]
	}
	// If we need more parts than phases, split the biggest phase
	for len(phases) < numParts {
		// Find largest
		maxIdx := 0
		for i, p := range phases {
			if p.pct > phases[maxIdx].pct {
				maxIdx = i
			}
		}
		half := phases[maxIdx].pct / 2
		origVerb := phases[maxIdx].verb
		phases[maxIdx].pct = half
		newPhase := splitPhase{verb: "Continue: " + origVerb, pct: phases[maxIdx].pct}
		// Insert after maxIdx
		phases = append(phases[:maxIdx+1], append([]splitPhase{newPhase}, phases[maxIdx+1:]...)...)
	}

	// Normalize percentages and distribute time
	totalPct := 0
	for _, p := range phases {
		totalPct += p.pct
	}

	splits := make([]models.SuggestedTask, len(phases))
	for i, p := range phases {
		partMin := totalMin * p.pct / totalPct
		if partMin < 5 {
			partMin = 5
		}
		splits[i] = models.SuggestedTask{
			Text:         fmt.Sprintf("%s %s", p.verb, taskText),
			Kind:         "must",
			EstimatedMin: partMin,
			Order:        i + 1,
		}
	}

	return splits
}

type splitPhase struct {
	verb string
	pct  int // percentage of total time
}

func summarizeEstContext(pc projectContext) string {
	var parts []string
	if pc.ProjectName != "" {
		parts = append(parts, fmt.Sprintf("project=%s", pc.ProjectName))
	}
	if pc.TotalTasksToday > 0 {
		parts = append(parts, fmt.Sprintf("%d/%d tasks done today", pc.CompletedToday, pc.TotalTasksToday))
	}
	if pc.OpenSessions > 0 {
		parts = append(parts, fmt.Sprintf("%d open sessions", pc.OpenSessions))
	}
	if len(parts) == 0 {
		return "no project context available"
	}
	return strings.Join(parts, ", ")
}

// estimateWithLLM sends parameterized context to Claude for estimation.
func estimateWithLLM(ctx context.Context, req models.EstimateRequest, pc projectContext, cfg CognitiveBudgetConfig, apiKey string) (models.TaskEstimate, error) {
	params := map[string]any{
		"task_text": req.TaskText,
		"project": map[string]any{
			"name":           pc.ProjectName,
			"directory_scan": pc.DirSummary,
			"has_prior_work": pc.HasPriorWork,
			"total_files":    pc.TotalFiles,
		},
		"current_state": map[string]any{
			"tasks_today":        pc.TotalTasksToday,
			"completed_today":    pc.CompletedToday,
			"open_sessions":      pc.OpenSessions,
			"historical_avg_min": pc.HistoricalAvg,
		},
		"recent_patterns": estSummarizePatterns(pc.PriorPatterns),
		"estimation_config": map[string]any{
			"max_minutes_before_split": cfg.MaxMinutesBeforeSplit,
			"focus_block_minutes":      90,
			"weight_scope":             cfg.WeightScope,
			"weight_novelty":           cfg.WeightNovelty,
			"weight_dependencies":      cfg.WeightDependencies,
			"weight_ambiguity":         cfg.WeightAmbiguity,
			"weight_prior_work":        cfg.WeightPriorWork,
			"weight_error_risk":        cfg.WeightErrorRisk,
			"weight_cognitive_switch":  cfg.WeightCognitiveSwitch,
		},
	}

	paramsJSON, _ := json.MarshalIndent(params, "", "  ")

	prompt := fmt.Sprintf(`You are Cogload, a cognitive complexity estimator for software developers.

Given a task and its project context, estimate the cognitive budget required.

## Parameterized Context
%s

## Instructions
Score each dimension of the complexity matrix from 1-10:
- scope: How many files/systems will this touch?
- novelty: Is this familiar work or new territory?
- dependencies: How many external integrations?
- ambiguity: How well-defined is the task? (Higher = more vague)
- prior_work: How much relevant existing code/context exists? (Higher = more helpful)
- error_risk: Likelihood of cascading errors?
- cognitive_switch: Does this require context-switching between domains?

Then estimate total minutes and whether the task should be split.

If it should be split, provide concrete sub-tasks that are each under %d minutes.

Respond with EXACTLY this JSON (no markdown, no code fences):
{
  "estimated_min": 120,
  "complexity": "high",
  "cognitive_load": 72,
  "confidence": 65,
  "should_split": true,
  "suggested_splits": [
    {"text": "Research and plan the API schema", "kind": "must", "estimated_min": 30, "order": 1},
    {"text": "Implement the backend endpoint", "kind": "must", "estimated_min": 45, "order": 2}
  ],
  "reasoning": "Brief explanation of the estimate",
  "matrix": {
    "scope": 6,
    "novelty": 5,
    "dependencies": 4,
    "ambiguity": 7,
    "prior_work": 3,
    "error_risk": 5,
    "cognitive_switch": 6
  }
}`, string(paramsJSON), cfg.MaxMinutesBeforeSplit)

	reqBody, _ := json.Marshal(map[string]any{
		"model":      "claude-sonnet-4-20250514",
		"max_tokens": 1024,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	})

	httpReq, err := http.NewRequestWithContext(ctx, "POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(reqBody))
	if err != nil {
		return models.TaskEstimate{}, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return models.TaskEstimate{}, fmt.Errorf("LLM request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return models.TaskEstimate{}, fmt.Errorf("LLM returned status %d", resp.StatusCode)
	}

	var llmResp struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&llmResp); err != nil {
		return models.TaskEstimate{}, fmt.Errorf("decode LLM response: %w", err)
	}

	if len(llmResp.Content) == 0 {
		return models.TaskEstimate{}, fmt.Errorf("empty LLM response")
	}

	var estimate models.TaskEstimate
	if err := json.Unmarshal([]byte(llmResp.Content[0].Text), &estimate); err != nil {
		return models.TaskEstimate{}, fmt.Errorf("parse LLM estimate: %w", err)
	}

	estimate.ID = fmt.Sprintf("est-%d", time.Now().UnixMilli())

	return estimate, nil
}

func estSummarizePatterns(patterns []models.Pattern) []map[string]string {
	seen := map[string]bool{}
	var summaries []map[string]string
	for _, p := range patterns {
		key := p.Kind + p.Severity
		if seen[key] {
			continue
		}
		seen[key] = true
		summaries = append(summaries, map[string]string{
			"kind":     p.Kind,
			"severity": p.Severity,
			"title":    p.Title,
		})
		if len(summaries) >= 5 {
			break
		}
	}
	return summaries
}

func estContainsAny(text string, keywords []string) bool {
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}

func estMin(a, b int) int {
	if a < b {
		return a
	}
	return b
}
