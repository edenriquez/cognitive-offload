package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/cogload/backend/internal/config"
	"github.com/cogload/backend/internal/engine"
	"github.com/cogload/backend/internal/ingest"
	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
	"github.com/cogload/backend/internal/ws"
)

func NewRouter(db *store.DB, hub *ws.Hub, eng *engine.Engine, coord *ingest.Coordinator) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Content-Type"},
		MaxAge:         300,
	}))

	h := &handler{db: db, hub: hub, eng: eng, coord: coord}

	r.Get("/ws/signals", hub.HandleWS)

	r.Route("/api/v1", func(r chi.Router) {
		// Today
		r.Get("/today", h.getToday)
		r.Patch("/today/tasks/{id}", h.toggleTask)

		// Tasks CRUD
		r.Post("/tasks", h.createTask)
		r.Put("/tasks/{id}", h.updateTask)
		r.Delete("/tasks/{id}", h.deleteTask)
		r.Post("/tasks/reorder", h.reorderTasks)

		// Focus
		r.Post("/focus/start", h.startFocus)
		r.Post("/focus/stop", h.stopFocus)
		r.Get("/focus/current", h.currentFocus)
		r.Get("/focus/history", h.focusHistory)

		// Capture
		r.Post("/captures", h.createCapture)
		r.Get("/captures", h.listCaptures)
		r.Delete("/captures/{id}", h.deleteCapture)
		r.Post("/captures/{id}/promote", h.promoteCapture)

		// Review
		r.Get("/review/{day}", h.getReview)
		r.Post("/review/patterns/{id}/acknowledge", h.acknowledgePattern)
		r.Post("/review/patterns/{id}/dismiss", h.dismissPattern)

		// Tomorrow
		r.Get("/tomorrow", h.getTomorrow)
		r.Post("/tomorrow/lock", h.lockTomorrow)
		r.Put("/tomorrow", h.updateTomorrow)
		r.Post("/tomorrow/regenerate", h.regenerateTomorrow)
		r.Post("/tomorrow/rollover", h.rolloverTomorrow)

		// Sessions
		r.Post("/sessions/{id}/close", h.closeSession)

		// Interventions
		r.Get("/interventions", h.listInterventions)

		// Ingestion
		r.Post("/ingest/events", h.ingestEvents)

		// Signals snapshot (HTTP fallback)
		r.Get("/signals/current", h.currentSignals)

		// Sources
		r.Get("/sources", h.getSources)

		// Config
		r.Get("/config", h.getConfig)
		r.Put("/config", h.updateConfig)

		r.Post("/sessions/cleanup", h.cleanupSessions)

		// Self-reports
		r.Post("/self-report", h.createSelfReport)
		r.Get("/self-reports", h.listSelfReports)

		// Projects
		r.Get("/projects", h.listProjects)
		r.Post("/projects", h.upsertProject)
		r.Put("/projects/{id}", h.updateProject)
		r.Delete("/projects/{id}", h.deleteProject)

		// Budget
		r.Get("/budget", h.getBudget)
		r.Put("/budget", h.updateBudget)

		// Report
		r.Get("/report/{day}", h.getReport)

		// Trends
		r.Get("/trends", h.getTrends)

		// Session scores
		r.Get("/sessions/scores", h.getSessionScores)

		// Calendar
		r.Get("/calendar", h.getCalendar)

		// LLM Analysis
		r.Post("/analyze/{day}", h.analyzeDayLLM)

		// Cognitive Budget Estimation
		r.Post("/tasks/{id}/estimate", h.estimateExistingTask)
		r.Post("/estimate", h.estimateNewTask)

		// Claude status
		r.Get("/claude/status", h.claudeStatus)
		r.Post("/claude/key", h.setClaudeKey)

		// Block budget
		r.Get("/blocks/config", h.getBlockConfig)
		r.Put("/blocks/config", h.updateBlockConfig)
		r.Get("/blocks/today", h.getBlockSchedule)
		r.Post("/blocks/generate", h.generateBlockSchedule)
		r.Post("/blocks/{id}/start", h.startBlock)
		r.Post("/blocks/{id}/complete", h.completeBlock)
		r.Post("/blocks/{id}/skip", h.skipBlock)

		// Task notes
		r.Get("/tasks/{id}/note", h.getTaskNote)
		r.Put("/tasks/{id}/note", h.upsertTaskNote)

		// Task dependency map
		r.Get("/map", h.getTaskGraph)
		r.Post("/map/edges", h.createEdge)
		r.Delete("/map/edges/{id}", h.deleteEdge)
		r.Get("/map/ready", h.getReadyTasks)
	})

	return r
}

type handler struct {
	db    *store.DB
	hub   *ws.Hub
	eng   *engine.Engine
	coord *ingest.Coordinator
}

func today() string { return time.Now().Format("2006-01-02") }

func tomorrow() string { return time.Now().AddDate(0, 0, 1).Format("2006-01-02") }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// ---------- Today ----------

func (h *handler) getToday(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	day := today()

	tasks, err := h.db.TasksByDay(ctx, day)
	if err != nil {
		slog.Error("get tasks", "error", err)
		http.Error(w, "internal error", 500)
		return
	}

	// Return empty list if no tasks — user creates their own
	if tasks == nil {
		tasks = []models.Task{}
	}

	bw := models.Bandwidth{Work: 60, Personal: 15, Admin: 15, Learning: 10}

	completed := 0
	for _, t := range tasks {
		if t.Done {
			completed++
		}
	}

	hour := float64(time.Now().Hour()) + float64(time.Now().Minute())/60.0
	greet := "Good morning"
	if hour >= 17 {
		greet = "Good evening"
	} else if hour >= 12 {
		greet = "Good afternoon"
	}

	// Active thread
	open, _ := h.db.OpenSessions(ctx, day)
	var active *models.SessionBrief
	if len(open) > 0 {
		s := open[0]
		dur := int(time.Since(s.StartedAt).Minutes())
		active = &models.SessionBrief{
			ID: s.ID, Label: s.Label, DurationMin: dur, LastTouchAgoSec: 180,
		}
	}

	writeJSON(w, 200, models.TodayResponse{
		Tasks:        tasks,
		Bandwidth:    bw,
		ActiveThread: active,
		Greet:        greet,
		Completed:    completed,
		Total:        len(tasks),
	})
}

func (h *handler) toggleTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.ToggleTask(r.Context(), id); err != nil {
		slog.Error("toggle task", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// ---------- Tasks CRUD ----------

type createTaskReq struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

func (h *handler) createTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskReq
	if err := readJSON(r, &req); err != nil || req.Text == "" {
		http.Error(w, "bad request", 400)
		return
	}
	ctx := r.Context()
	day := today()
	if req.Kind == "" {
		req.Kind = "must"
	}
	idx, _ := h.db.NextTaskIdx(ctx, day, req.Kind)
	t := models.Task{
		ID:   fmt.Sprintf("t-%d", time.Now().UnixNano()),
		Day:  day,
		Kind: req.Kind,
		Idx:  idx,
		Text: req.Text,
		Done: false,
	}
	if err := h.db.CreateTask(ctx, t); err != nil {
		slog.Error("create task", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 201, t)
}

type updateTaskReq struct {
	Text string `json:"text"`
	Kind string `json:"kind"`
	Idx  int    `json:"idx"`
}

func (h *handler) updateTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateTaskReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if err := h.db.UpdateTask(r.Context(), id, req.Text, req.Kind, req.Idx); err != nil {
		slog.Error("update task", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "updated"})
}

func (h *handler) deleteTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.DeleteTask(r.Context(), id); err != nil {
		slog.Error("delete task", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

type reorderReq struct {
	Orders []models.TaskOrder `json:"orders"`
}

func (h *handler) reorderTasks(w http.ResponseWriter, r *http.Request) {
	var req reorderReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if err := h.db.ReorderTasks(r.Context(), req.Orders); err != nil {
		slog.Error("reorder tasks", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "reordered"})
}

// ---------- Focus (with persistence) ----------

type focusReq struct {
	TaskID string `json:"task_id"`
}

func (h *handler) startFocus(w http.ResponseWriter, r *http.Request) {
	var req focusReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	ctx := r.Context()

	// Find task text
	taskText := req.TaskID
	tasks, _ := h.db.TasksByDay(ctx, today())
	for _, t := range tasks {
		if t.ID == req.TaskID {
			taskText = t.Text
			break
		}
	}

	fs := models.FocusSession{
		ID:        fmt.Sprintf("fs-%d", time.Now().UnixNano()),
		TaskID:    req.TaskID,
		TaskText:  taskText,
		StartedAt: time.Now(),
		Outcome:   "active",
	}
	if err := h.db.StartFocusSession(ctx, fs); err != nil {
		slog.Error("start focus", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, fs)
}

type stopFocusReq struct {
	Outcome string `json:"outcome"` // done | paused
}

func (h *handler) stopFocus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	active, err := h.db.ActiveFocusSession(ctx)
	if err != nil || active == nil {
		http.Error(w, "no active focus session", 404)
		return
	}
	var req stopFocusReq
	readJSON(r, &req)
	outcome := req.Outcome
	if outcome == "" {
		outcome = "done"
	}
	if err := h.db.StopFocusSession(ctx, active.ID, outcome); err != nil {
		slog.Error("stop focus", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "stopped", "outcome": outcome})
}

func (h *handler) currentFocus(w http.ResponseWriter, r *http.Request) {
	fs, err := h.db.ActiveFocusSession(r.Context())
	if err != nil {
		slog.Error("current focus", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	if fs == nil {
		writeJSON(w, 200, map[string]any{"active": false})
		return
	}
	writeJSON(w, 200, fs)
}

func (h *handler) focusHistory(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if day == "" {
		day = today()
	}
	sessions, err := h.db.FocusSessionsByDay(r.Context(), day)
	if err != nil {
		slog.Error("focus history", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	if sessions == nil {
		sessions = []models.FocusSession{}
	}
	writeJSON(w, 200, sessions)
}

// ---------- Capture ----------

type captureReq struct {
	Text string `json:"text"`
}

func (h *handler) createCapture(w http.ResponseWriter, r *http.Request) {
	var req captureReq
	if err := readJSON(r, &req); err != nil || req.Text == "" {
		http.Error(w, "bad request", 400)
		return
	}
	c := models.Capture{
		ID:        fmt.Sprintf("cap-%d", time.Now().UnixNano()),
		Text:      req.Text,
		CreatedAt: time.Now(),
	}
	if err := h.db.InsertCapture(r.Context(), c); err != nil {
		slog.Error("insert capture", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 201, c)
}

func (h *handler) listCaptures(w http.ResponseWriter, r *http.Request) {
	caps, err := h.db.RecentCaptures(r.Context(), 20)
	if err != nil {
		slog.Error("list captures", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	if caps == nil {
		caps = []models.Capture{}
	}
	writeJSON(w, 200, caps)
}

func (h *handler) deleteCapture(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.DeleteCapture(r.Context(), id); err != nil {
		slog.Error("delete capture", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

func (h *handler) promoteCapture(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()

	cap, err := h.db.GetCapture(ctx, id)
	if err != nil || cap == nil {
		http.Error(w, "capture not found", 404)
		return
	}

	day := today()
	idx, _ := h.db.NextTaskIdx(ctx, day, "must")
	t := models.Task{
		ID:   fmt.Sprintf("t-%d", time.Now().UnixNano()),
		Day:  day,
		Kind: "must",
		Idx:  idx,
		Text: cap.Text,
		Done: false,
	}
	if err := h.db.CreateTask(ctx, t); err != nil {
		slog.Error("promote capture", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	// Delete the capture after promotion
	h.db.DeleteCapture(ctx, id)
	writeJSON(w, 201, t)
}

// ---------- Review ----------

func (h *handler) getReview(w http.ResponseWriter, r *http.Request) {
	day := chi.URLParam(r, "day")
	ctx := r.Context()

	// Run aggregator on-demand so review always has fresh buckets
	if h.coord != nil {
		h.coord.RunAggregator(ctx)
	}

	// Detect patterns from real data
	patterns, _ := engine.DetectPatterns(ctx, h.db, day)
	if patterns == nil {
		patterns = []models.Pattern{}
	}

	// Compute energy leaks from buckets
	leaks := engine.ComputeLeaks(ctx, h.db, day)
	if leaks == nil {
		leaks = []models.Leak{}
	}

	// Infer root causes from patterns
	rootCauses := engine.InferRootCauses(ctx, h.db, day)
	if rootCauses == nil {
		rootCauses = []models.RootCause{}
	}

	// Compute daily summary from real data
	summary := engine.ComputeDaySummary(ctx, h.db, day)

	// Get raw data for display
	buckets, _ := h.db.BucketsByDay(ctx, day)
	if buckets == nil {
		buckets = []models.Bucket{}
	}

	sessions, _ := h.db.SessionsByDay(ctx, day)
	if sessions == nil {
		sessions = []models.Session{}
	}

	selfReports, _ := h.db.SelfReportsByDay(ctx, day)
	if selfReports == nil {
		selfReports = []models.SelfReport{}
	}

	review := models.ReviewSummary{
		Summary:     summary,
		EnergyMap:   buckets,
		Patterns:    patterns,
		Leaks:       leaks,
		RootCauses:  rootCauses,
		Sessions:    sessions,
		SelfReports: selfReports,
	}

	// Auto-persist daily summary for calendar/trends
	scores := engine.ScoreAllSessions(ctx, h.db, day)
	scoreSummary := engine.SummarizeSessionScores(scores)
	momentum := engine.ComputeMomentum(ctx, h.db, day)
	avgScore := float64(0)
	if scoreSummary.TotalSessions > 0 {
		totalScore := 0
		for _, s := range scores {
			totalScore += s.OutputScore
		}
		avgScore = float64(totalScore) / float64(scoreSummary.TotalSessions)
	}
	h.db.UpsertDailySummary(ctx, models.DailySummaryRecord{
		Day:             day,
		DeepWorkMin:     summary.DeepWorkMin,
		LeakedMin:       summary.LeakedMin,
		SessionsCount:   summary.SessionsCount,
		AvgSessionScore: avgScore,
		MomentumPeak:    momentum.PeakVelocity,
		WallTime:        momentum.WallTime,
		BudgetAdherence: 0,
	})

	writeJSON(w, 200, review)
}

func (h *handler) acknowledgePattern(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.AcknowledgePattern(r.Context(), id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "acknowledged"})
}

func (h *handler) dismissPattern(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.DismissPattern(r.Context(), id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "dismissed"})
}

// ---------- Tomorrow ----------

func (h *handler) getTomorrow(w http.ResponseWriter, r *http.Request) {
	day := tomorrow()
	ctx := r.Context()

	plan, err := h.db.PlanByDay(ctx, day)
	if err != nil {
		slog.Error("get plan", "error", err)
		http.Error(w, "internal error", 500)
		return
	}

	if plan == nil {
		// Auto-generate from today's data
		todayStr := today()
		generated := engine.GeneratePlan(ctx, h.db, todayStr, day)

		if generated != nil && (len(generated.Constraints) > 0 || len(generated.Tasks) > 0) {
			// Save the generated plan
			h.db.UpsertPlan(ctx, *generated)
			plan = generated
		} else {
			// No data to generate from — return empty draft
			plan = &models.Plan{
				Day:         day,
				Status:      "draft",
				Headline:    "No plan yet. Work today to generate tomorrow's plan.",
				Constraints: []models.Constraint{},
				Bandwidth:   models.Bandwidth{Work: 60, Personal: 15, Admin: 15, Learning: 10},
				Tasks:       []models.Task{},
			}
		}
	}

	writeJSON(w, 200, plan)
}

func (h *handler) lockTomorrow(w http.ResponseWriter, r *http.Request) {
	day := tomorrow()
	ctx := r.Context()

	plan, _ := h.db.PlanByDay(ctx, day)
	if plan == nil {
		http.Error(w, "no plan exists", 404)
		return
	}
	now := time.Now()
	plan.Status = "locked"
	plan.LockedAt = &now
	if err := h.db.UpsertPlan(ctx, *plan); err != nil {
		slog.Error("lock plan", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, plan)
}

func (h *handler) updateTomorrow(w http.ResponseWriter, r *http.Request) {
	day := tomorrow()
	ctx := r.Context()

	plan, _ := h.db.PlanByDay(ctx, day)
	if plan == nil {
		http.Error(w, "no plan exists", 404)
		return
	}
	if plan.Status == "locked" {
		http.Error(w, "plan is already locked", 409)
		return
	}

	var updates models.Plan
	if err := readJSON(r, &updates); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	// Merge: only update fields that are provided
	if updates.Headline != "" {
		plan.Headline = updates.Headline
	}
	if len(updates.Constraints) > 0 {
		plan.Constraints = updates.Constraints
	}
	if updates.Bandwidth.Work > 0 || updates.Bandwidth.Personal > 0 {
		plan.Bandwidth = updates.Bandwidth
	}
	if len(updates.Tasks) > 0 {
		plan.Tasks = updates.Tasks
	}

	if err := h.db.UpdatePlan(ctx, *plan); err != nil {
		slog.Error("update plan", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, plan)
}

func (h *handler) regenerateTomorrow(w http.ResponseWriter, r *http.Request) {
	day := tomorrow()
	todayStr := today()
	ctx := r.Context()

	// Delete existing draft plan (only if not locked)
	existing, _ := h.db.PlanByDay(ctx, day)
	if existing != nil && existing.Status == "locked" {
		http.Error(w, "plan is already locked \u2014 cannot regenerate", 409)
		return
	}

	// Generate fresh plan from today's data
	generated := engine.GeneratePlan(ctx, h.db, todayStr, day)
	if generated == nil {
		http.Error(w, "no data to generate plan from", 404)
		return
	}

	h.db.UpsertPlan(ctx, *generated)
	slog.Info("plan regenerated", "day", day)
	writeJSON(w, 200, generated)
}

func (h *handler) rolloverTomorrow(w http.ResponseWriter, r *http.Request) {
	tomorrowDay := tomorrow()
	todayStr := today()
	ctx := r.Context()

	// Get the plan (locked or draft)
	plan, _ := h.db.PlanByDay(ctx, tomorrowDay)
	if plan == nil {
		// Auto-generate first
		plan = engine.GeneratePlan(ctx, h.db, todayStr, tomorrowDay)
		if plan == nil {
			http.Error(w, "no plan exists and none could be generated", 404)
			return
		}
		h.db.UpsertPlan(ctx, *plan)
	}

	// Copy plan tasks into tomorrow's tasks table
	tasks := plan.Tasks
	if len(tasks) == 0 {
		writeJSON(w, 200, map[string]any{"status": "rollover", "tasks_created": 0})
		return
	}

	created := 0
	for _, t := range tasks {
		newTask := models.Task{
			ID:   fmt.Sprintf("t-%d-%d", time.Now().UnixNano(), created),
			Day:  tomorrowDay,
			Kind: t.Kind,
			Idx:  t.Idx,
			Text: t.Text,
			Done: false,
		}
		if err := h.db.CreateTask(ctx, newTask); err != nil {
			slog.Error("rollover task create failed", "error", err, "text", t.Text)
			continue
		}
		created++
	}

	// Mark plan as completed
	plan.Status = "completed"
	h.db.UpsertPlan(ctx, *plan)

	slog.Info("plan rolled over", "day", tomorrowDay, "tasks_created", created)
	writeJSON(w, 200, map[string]any{"status": "rollover", "tasks_created": created, "day": tomorrowDay})
}

// ---------- Sessions ----------

func (h *handler) closeSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.CloseSession(r.Context(), id); err != nil {
		slog.Error("close session", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "closed"})
}

// ---------- Interventions ----------

func (h *handler) listInterventions(w http.ResponseWriter, r *http.Request) {
	s, err := h.eng.ComputeSignals(r.Context())
	if err != nil {
		slog.Error("compute signals", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	hour := float64(time.Now().Hour()) + float64(time.Now().Minute())/60.0
	interventions := h.eng.EvaluateRules(s, hour)
	writeJSON(w, 200, interventions)
}

// ---------- Signals ----------

func (h *handler) currentSignals(w http.ResponseWriter, r *http.Request) {
	snap, err := h.eng.SignalSnapshot(r.Context())
	if err != nil {
		slog.Error("signal snapshot", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, snap)
}

// ---------- Ingestion ----------

type ingestReq struct {
	Events []models.RawEvent `json:"events"`
}

func (h *handler) ingestEvents(w http.ResponseWriter, r *http.Request) {
	var req ingestReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if err := h.db.InsertEvents(r.Context(), req.Events); err != nil {
		slog.Error("ingest events", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]int{"ingested": len(req.Events)})
}

// ---------- Sources ----------

func (h *handler) getSources(w http.ResponseWriter, r *http.Request) {
	if h.coord == nil {
		writeJSON(w, 200, []ingest.SourceStatus{})
		return
	}
	sources := h.coord.Status(r.Context())
	writeJSON(w, 200, sources)
}

func (h *handler) getConfig(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	// Don't expose the full API key in config responses
	if cfg.AnthropicKey != "" {
		if len(cfg.AnthropicKey) > 8 {
			cfg.AnthropicKey = cfg.AnthropicKey[:4] + "..." + cfg.AnthropicKey[len(cfg.AnthropicKey)-4:]
		} else {
			cfg.AnthropicKey = "****"
		}
	}
	writeJSON(w, 200, cfg)
}

func (h *handler) updateConfig(w http.ResponseWriter, r *http.Request) {
	var updates config.Config
	if err := readJSON(r, &updates); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	cfg := config.Load()
	if updates.CutoffHour > 0 {
		cfg.CutoffHour = updates.CutoffHour
	}
	if updates.LunchStart > 0 {
		cfg.LunchStart = updates.LunchStart
	}
	if updates.LunchEnd > 0 {
		cfg.LunchEnd = updates.LunchEnd
	}
	if len(updates.WatchPaths) > 0 {
		cfg.WatchPaths = updates.WatchPaths
	}
	if updates.DisabledRules != nil {
		cfg.DisabledRules = updates.DisabledRules
	}
	config.Save(cfg)
	slog.Info("config updated", "cutoff", cfg.CutoffHour, "lunch", cfg.LunchStart)
	writeJSON(w, 200, cfg)
}

// ---------- Self Reports ----------

type selfReportReq struct {
	Level int    `json:"level"` // 1-5
	Label string `json:"label"`
	Note  string `json:"note"`
}

func (h *handler) createSelfReport(w http.ResponseWriter, r *http.Request) {
	var req selfReportReq
	if err := readJSON(r, &req); err != nil || req.Level < 1 || req.Level > 5 {
		http.Error(w, "bad request: level must be 1-5", 400)
		return
	}
	now := time.Now()
	day := today()
	bucketIdx := (now.Hour()*60 + now.Minute()) / 10

	if req.Label == "" {
		labels := []string{"", "fresh", "focused", "loaded", "tired", "degraded"}
		req.Label = labels[req.Level]
	}

	if err := h.db.InsertSelfReport(r.Context(), day, req.Level, req.Label, now.UnixMilli(), bucketIdx, req.Note); err != nil {
		slog.Error("create self-report", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 201, map[string]any{"status": "recorded", "level": req.Level, "label": req.Label, "bucket_idx": bucketIdx})
}

func (h *handler) listSelfReports(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if day == "" {
		day = today()
	}
	reports, err := h.db.SelfReportsByDay(r.Context(), day)
	if err != nil {
		slog.Error("list self-reports", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	if reports == nil {
		reports = []models.SelfReport{}
	}
	writeJSON(w, 200, reports)
}

func (h *handler) cleanupSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	today := today()

	// Close all sessions that are not from today
	result, err := h.db.CloseOldSessions(ctx, today)
	if err != nil {
		slog.Error("cleanup sessions failed", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	slog.Info("sessions cleaned up", "closed", result)
	writeJSON(w, 200, map[string]any{"status": "cleaned", "closed": result})
}

// ---------- Projects ----------

func (h *handler) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.db.ListProjects(r.Context())
	if err != nil {
		projects = []models.Project{}
	}
	writeJSON(w, 200, projects)
}

func (h *handler) upsertProject(w http.ResponseWriter, r *http.Request) {
	var p models.Project
	if err := readJSON(r, &p); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if p.ID == "" {
		p.ID = fmt.Sprintf("p-%d", time.Now().UnixNano())
	}
	if err := h.db.UpsertProject(r.Context(), p); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, p)
}

func (h *handler) updateProject(w http.ResponseWriter, r *http.Request) {
	var p models.Project
	if err := readJSON(r, &p); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	p.ID = chi.URLParam(r, "id")
	if err := h.db.UpsertProject(r.Context(), p); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, p)
}

func (h *handler) deleteProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.db.DeleteProject(r.Context(), id)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// ---------- Budget ----------

func (h *handler) getBudget(w http.ResponseWriter, r *http.Request) {
	day := time.Now().Format("2006-01-02")
	budget, err := h.db.GetBudget(r.Context(), day)
	if err != nil {
		budget = models.DailyBudget{Day: day, Allocations: []models.BudgetEntry{}}
	}
	writeJSON(w, 200, budget)
}

func (h *handler) updateBudget(w http.ResponseWriter, r *http.Request) {
	var budget models.DailyBudget
	if err := readJSON(r, &budget); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if budget.Day == "" {
		budget.Day = time.Now().Format("2006-01-02")
	}
	if err := h.db.UpsertBudget(r.Context(), budget); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, budget)
}

// ---------- Report ----------

func (h *handler) getReport(w http.ResponseWriter, r *http.Request) {
	day := chi.URLParam(r, "day")
	if day == "" {
		day = time.Now().Format("2006-01-02")
	}
	report := engine.GenerateReport(r.Context(), h.db, day)
	writeJSON(w, 200, report)
}

// ---------- Trends ----------

func (h *handler) getTrends(w http.ResponseWriter, r *http.Request) {
	daysStr := r.URL.Query().Get("days")
	days := 7
	if daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil && d > 0 && d <= 90 {
			days = d
		}
	}
	trends, err := h.db.GetTrends(r.Context(), days)
	if err != nil {
		trends = []models.DailySummaryRecord{}
	}
	writeJSON(w, 200, trends)
}

// ---------- Session Scores ----------

func (h *handler) getSessionScores(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if day == "" {
		day = time.Now().Format("2006-01-02")
	}
	scores := engine.ScoreAllSessions(r.Context(), h.db, day)
	if scores == nil {
		scores = []engine.SessionScore{}
	}
	writeJSON(w, 200, scores)
}

// ---------- Calendar ----------

func (h *handler) getCalendar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get persisted daily summaries
	trends, err := h.db.GetTrends(ctx, 365)
	if err != nil {
		trends = []models.DailySummaryRecord{}
	}

	// Get session counts for all days (includes days without summaries)
	sessionCounts, _ := h.db.SessionCountsByDay(ctx, 365)

	// Build a map of existing summaries
	summaryMap := make(map[string]*models.DailySummaryRecord, len(trends))
	for i := range trends {
		summaryMap[trends[i].Day] = &trends[i]
	}

	// Merge: ensure every day with sessions has an entry
	for day, count := range sessionCounts {
		if _, exists := summaryMap[day]; !exists {
			trends = append(trends, models.DailySummaryRecord{
				Day:           day,
				SessionsCount: count,
			})
		}
	}

	writeJSON(w, 200, trends)
}

// ---------- LLM Analysis ----------

func (h *handler) analyzeDayLLM(w http.ResponseWriter, r *http.Request) {
	day := chi.URLParam(r, "day")
	ctx := r.Context()

	summary := engine.ComputeDaySummary(ctx, h.db, day)
	patterns, _ := engine.DetectPatterns(ctx, h.db, day)
	leaks := engine.ComputeLeaks(ctx, h.db, day)
	sessions, _ := h.db.SessionsByDay(ctx, day)
	scores := engine.ScoreAllSessions(ctx, h.db, day)
	momentum := engine.ComputeMomentum(ctx, h.db, day)
	selfReports, _ := h.db.SelfReportsByDay(ctx, day)

	llmContext := map[string]any{
		"day": day,
		"summary": map[string]any{
			"deep_work_min":  summary.DeepWorkMin,
			"leaked_min":     summary.LeakedMin,
			"sessions_count": summary.SessionsCount,
			"open_loops":     summary.OpenLoops,
		},
		"patterns":       patterns,
		"leaks":          leaks,
		"session_count":  len(sessions),
		"session_scores": scores,
		"momentum": map[string]any{
			"total_messages": momentum.TotalMessages,
			"total_saves":    momentum.TotalSaves,
			"total_commits":  momentum.TotalCommits,
			"peak_velocity":  momentum.PeakVelocity,
			"wall_detected":  momentum.WallDetected,
			"wall_time":      momentum.WallTime,
		},
		"self_reports": selfReports,
	}

	contextJSON, _ := json.MarshalIndent(llmContext, "", "  ")
	prompt := fmt.Sprintf("You are Cogload, a cognitive load analyst. Analyze this developer's day and provide insights.\n\nData for %s:\n%s\n\nRespond with EXACTLY this JSON structure (no markdown, no code fences):\n{\n  \"headline\": \"One-sentence summary of the day\",\n  \"analysis\": [\n    {\"title\": \"Section title\", \"content\": \"2-3 sentence analysis\"}\n  ],\n  \"suggestions\": [\n    {\"title\": \"Actionable suggestion\", \"detail\": \"Specific recommendation\", \"metric\": \"How to measure improvement\"}\n  ],\n  \"cognitive_score\": 75,\n  \"productivity_rating\": \"high|medium|low\"\n}\n\nFocus on:\n1. How effectively AI sessions translated to code output\n2. When cognitive momentum peaked and declined\n3. Whether the developer hit the e-bike wall\n4. Specific, actionable changes for tomorrow\nKeep analysis concise — max 3 analysis sections and 3 suggestions.", day, string(contextJSON))

	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		report := engine.GenerateReport(ctx, h.db, day)
		writeJSON(w, 200, map[string]any{
			"source":              "template",
			"headline":            "Daily summary for " + day,
			"analysis":            report.Sections,
			"suggestions":         report.Suggestions,
			"cognitive_score":     0,
			"productivity_rating": "",
		})
		return
	}

	reqBody, _ := json.Marshal(map[string]any{
		"model":      "claude-sonnet-4-20250514",
		"max_tokens": 1024,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	})

	httpReq, _ := http.NewRequestWithContext(ctx, "POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(reqBody))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		slog.Error("LLM analysis failed", "error", err)
		report := engine.GenerateReport(ctx, h.db, day)
		writeJSON(w, 200, map[string]any{
			"source":      "template",
			"headline":    "Daily summary for " + day,
			"analysis":    report.Sections,
			"suggestions": report.Suggestions,
		})
		return
	}
	defer resp.Body.Close()

	var llmResp struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	json.NewDecoder(resp.Body).Decode(&llmResp)

	if len(llmResp.Content) == 0 {
		report := engine.GenerateReport(ctx, h.db, day)
		writeJSON(w, 200, map[string]any{
			"source":      "template",
			"analysis":    report.Sections,
			"suggestions": report.Suggestions,
		})
		return
	}

	var analysis map[string]any
	text := llmResp.Content[0].Text
	if err := json.Unmarshal([]byte(text), &analysis); err != nil {
		analysis = map[string]any{
			"source":      "llm",
			"headline":    "AI Analysis for " + day,
			"analysis":    []map[string]string{{"title": "Analysis", "content": text}},
			"suggestions": []any{},
		}
	} else {
		analysis["source"] = "llm"
	}

	writeJSON(w, 200, analysis)
}

// claudeStatus checks if ANTHROPIC_API_KEY is available.
func (h *handler) claudeStatus(w http.ResponseWriter, r *http.Request) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		// Fallback: check config file
		cfg := config.Load()
		if cfg.AnthropicKey != "" {
			key = cfg.AnthropicKey
			os.Setenv("ANTHROPIC_API_KEY", key)
		}
	}
	online := key != ""
	masked := ""
	if online && len(key) > 8 {
		masked = key[:4] + "..." + key[len(key)-4:]
	} else if online {
		masked = "****"
	}
	writeJSON(w, 200, map[string]any{
		"online":     online,
		"masked_key": masked,
	})
}

// setClaudeKey persists the ANTHROPIC_API_KEY to config and environment.
func (h *handler) setClaudeKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key string `json:"key"`
	}
	if err := readJSON(r, &body); err != nil || body.Key == "" {
		http.Error(w, "key is required", 400)
		return
	}
	os.Setenv("ANTHROPIC_API_KEY", body.Key)
	// Persist to config file so it survives restarts
	cfg := config.Load()
	cfg.AnthropicKey = body.Key
	config.Save(cfg)
	slog.Info("ANTHROPIC_API_KEY updated and persisted")
	writeJSON(w, 200, map[string]any{"status": "ok"})
}

// estimateExistingTask estimates the cognitive budget for an existing task.
func (h *handler) estimateExistingTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	ctx := r.Context()
	today := time.Now().Format("2006-01-02")

	// Find the task
	tasks, err := h.db.TasksByDay(ctx, today)
	if err != nil {
		http.Error(w, "failed to load tasks", 500)
		return
	}

	var taskText string
	for _, t := range tasks {
		if t.ID == taskID {
			taskText = t.Text
			break
		}
	}
	if taskText == "" {
		http.Error(w, "task not found", 404)
		return
	}

	// Optional project_path from body
	var body struct {
		ProjectPath string `json:"project_path"`
	}
	_ = readJSON(r, &body)

	estimate, err := engine.EstimateTask(ctx, h.db, models.EstimateRequest{
		TaskText:    taskText,
		TaskID:      taskID,
		ProjectPath: body.ProjectPath,
	})
	if err != nil {
		slog.Error("estimation failed", "error", err)
		http.Error(w, "estimation failed: "+err.Error(), 500)
		return
	}

	writeJSON(w, 200, estimate)
}

// estimateNewTask estimates the cognitive budget for a task description (not yet created).
func (h *handler) estimateNewTask(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req models.EstimateRequest
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "invalid request body", 400)
		return
	}
	if req.TaskText == "" {
		http.Error(w, "task_text is required", 400)
		return
	}

	estimate, err := engine.EstimateTask(ctx, h.db, req)
	if err != nil {
		slog.Error("estimation failed", "error", err)
		http.Error(w, "estimation failed: "+err.Error(), 500)
		return
	}

	writeJSON(w, 200, estimate)
}

// Suppress unused import warning
var _ = math.Min
var _ = sort.Slice

// ── Block Budget Handlers ───────────────────────────────────────────────────

func (h *handler) getBlockConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.db.GetBlockConfig(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, cfg)
}

func (h *handler) updateBlockConfig(w http.ResponseWriter, r *http.Request) {
	var cfg models.BlockConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "invalid body", 400)
		return
	}
	// Validate allocations sum to 100
	total := 0
	for _, a := range cfg.Allocations {
		total += a.Pct
	}
	if total != 100 && len(cfg.Allocations) > 0 {
		http.Error(w, "allocations must sum to 100", 400)
		return
	}
	if cfg.BlockDurationMin <= 0 {
		cfg.BlockDurationMin = 90
	}
	if err := h.db.UpsertBlockConfig(r.Context(), cfg); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, cfg)
}

func (h *handler) getBlockSchedule(w http.ResponseWriter, r *http.Request) {
	day := time.Now().Format("2006-01-02")
	blocks, err := h.db.DayBlocks(r.Context(), day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	cfg, err := h.db.GetBlockConfig(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	schedule := models.DaySchedule{
		Day:            day,
		Blocks:         blocks,
		NonNegotiables: todayNonNegotiables(cfg.NonNegotiables),
		TotalBlocks:    len(blocks),
	}

	completed := 0
	for i := range blocks {
		if blocks[i].Status == "completed" {
			completed++
		}
		if blocks[i].Status == "active" {
			schedule.ActiveBlock = &blocks[i]
		}
	}
	schedule.CompletedBlocks = completed
	schedule.BlocksRemaining = schedule.TotalBlocks - completed
	schedule.DayComplete = completed >= schedule.TotalBlocks && schedule.TotalBlocks > 0

	writeJSON(w, 200, schedule)
}

func (h *handler) generateBlockSchedule(w http.ResponseWriter, r *http.Request) {
	day := time.Now().Format("2006-01-02")
	ctx := r.Context()

	cfg, err := h.db.GetBlockConfig(ctx)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	// Delete existing blocks for today (regenerate)
	if err := h.db.DeleteDayBlocks(ctx, day); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	blocks := generateBlocks(day, cfg)

	if err := h.db.InsertDayBlocks(ctx, blocks); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	// Return the full schedule
	schedule := models.DaySchedule{
		Day:             day,
		Blocks:          blocks,
		NonNegotiables:  todayNonNegotiables(cfg.NonNegotiables),
		TotalBlocks:     len(blocks),
		BlocksRemaining: len(blocks),
	}
	writeJSON(w, 200, schedule)
}

func (h *handler) startBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	day := time.Now().Format("2006-01-02")
	ctx := r.Context()

	blocks, err := h.db.DayBlocks(ctx, day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	// Find the block and ensure no other block is active
	var target *models.DayBlock
	for i := range blocks {
		if blocks[i].Status == "active" && blocks[i].ID != id {
			http.Error(w, "another block is already active", 409)
			return
		}
		if blocks[i].ID == id {
			target = &blocks[i]
		}
	}
	if target == nil {
		http.Error(w, "block not found", 404)
		return
	}
	if target.Status != "planned" {
		http.Error(w, "block is not in planned status", 400)
		return
	}

	target.Status = "active"
	target.ActualStart = time.Now().Unix()
	if err := h.db.UpdateDayBlock(ctx, *target); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, target)
}

func (h *handler) completeBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	day := time.Now().Format("2006-01-02")
	ctx := r.Context()

	blocks, err := h.db.DayBlocks(ctx, day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	var target *models.DayBlock
	for i := range blocks {
		if blocks[i].ID == id {
			target = &blocks[i]
			break
		}
	}
	if target == nil {
		http.Error(w, "block not found", 404)
		return
	}

	target.Status = "completed"
	target.ActualEnd = time.Now().Unix()
	if err := h.db.UpdateDayBlock(ctx, *target); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, target)
}

func (h *handler) skipBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	day := time.Now().Format("2006-01-02")
	ctx := r.Context()

	blocks, err := h.db.DayBlocks(ctx, day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	var target *models.DayBlock
	for i := range blocks {
		if blocks[i].ID == id {
			target = &blocks[i]
			break
		}
	}
	if target == nil {
		http.Error(w, "block not found", 404)
		return
	}

	target.Status = "skipped"
	if err := h.db.UpdateDayBlock(ctx, *target); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, target)
}

// ── Block generation helpers ────────────────────────────────────────────────

// todayNonNegotiables filters non-negotiables to those active on today's day-of-week.
func todayNonNegotiables(all []models.NonNegotiable) []models.NonNegotiable {
	dow := int(time.Now().Weekday()) // 0=Sun
	var result []models.NonNegotiable
	for _, nn := range all {
		if len(nn.Days) == 0 {
			result = append(result, nn) // every day
		} else {
			for _, d := range nn.Days {
				if d == dow {
					result = append(result, nn)
					break
				}
			}
		}
	}
	return result
}

// generateBlocks creates the day's block schedule from config.
func generateBlocks(day string, cfg models.BlockConfig) []models.DayBlock {
	blockDur := cfg.BlockDurationMin
	if blockDur <= 0 {
		blockDur = 90
	}

	startMin := int(cfg.WorkDayStartHour * 60) // e.g. 9*60 = 540
	endMin := int(cfg.WorkDayEndHour * 60)     // e.g. 17*60 = 1020

	// Get today's non-negotiables sorted by start
	nns := todayNonNegotiables(cfg.NonNegotiables)

	// Build list of available time slots (start_min, end_min) avoiding non-negotiables
	type slot struct{ start, end int }
	var slots []slot

	cursor := startMin
	// Sort non-negotiables by start hour
	sort.Slice(nns, func(i, j int) bool {
		return nns[i].StartHour < nns[j].StartHour
	})

	for _, nn := range nns {
		nnStart := int(nn.StartHour * 60)
		nnEnd := int(nn.EndHour * 60)
		if nnStart > cursor {
			slots = append(slots, slot{cursor, nnStart})
		}
		if nnEnd > cursor {
			cursor = nnEnd
		}
	}
	if cursor < endMin {
		slots = append(slots, slot{cursor, endMin})
	}

	// Count how many blocks fit in total
	totalAvailMin := 0
	for _, s := range slots {
		totalAvailMin += s.end - s.start
	}
	totalBlocks := totalAvailMin / blockDur

	if totalBlocks == 0 {
		return nil
	}

	// Distribute blocks across categories by percentage
	type catBlocks struct {
		category string
		label    string
		color    string
		count    int
	}
	var cats []catBlocks
	assigned := 0
	for i, a := range cfg.Allocations {
		n := (a.Pct * totalBlocks) / 100
		if i == len(cfg.Allocations)-1 {
			n = totalBlocks - assigned // give remainder to last category
		}
		if n > 0 {
			cats = append(cats, catBlocks{a.Category, a.Label, a.Color, n})
			assigned += n
		}
	}

	// Build block sequence: interleave categories for variety
	var blockCats []catBlocks
	remaining := make([]int, len(cats))
	for i, c := range cats {
		remaining[i] = c.count
	}
	for len(blockCats) < totalBlocks {
		added := false
		for i, c := range cats {
			if remaining[i] > 0 {
				blockCats = append(blockCats, c)
				remaining[i]--
				added = true
				if len(blockCats) >= totalBlocks {
					break
				}
			}
		}
		if !added {
			break
		}
	}

	// Place blocks into time slots
	var blocks []models.DayBlock
	blockIdx := 0
	slotIdx := 0
	slotCursor := 0
	if len(slots) > 0 {
		slotCursor = slots[0].start
	}

	for blockIdx < len(blockCats) && slotIdx < len(slots) {
		s := slots[slotIdx]
		if slotCursor+blockDur <= s.end {
			cat := blockCats[blockIdx]
			blocks = append(blocks, models.DayBlock{
				ID:          fmt.Sprintf("blk-%s-%d", day, blockIdx),
				Day:         day,
				Idx:         blockIdx,
				Category:    cat.category,
				Label:       cat.label,
				StartMinute: slotCursor,
				EndMinute:   slotCursor + blockDur,
				Status:      "planned",
			})
			slotCursor += blockDur
			blockIdx++
		} else {
			// Move to next slot
			slotIdx++
			if slotIdx < len(slots) {
				slotCursor = slots[slotIdx].start
			}
		}
	}

	return blocks
}

// ── Map handlers ─────────────────────────────────────────────────────────────────────

func (h *handler) getTaskGraph(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if day == "" {
		day = today()
	}
	ctx := r.Context()

	tasks, err := h.db.TasksByDay(ctx, day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if tasks == nil {
		tasks = []models.Task{}
	}

	edges, err := h.db.ListEdgesForDay(ctx, day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if edges == nil {
		edges = []models.TaskEdge{}
	}

	writeJSON(w, 200, models.TaskGraph{Tasks: tasks, Edges: edges})
}

type createEdgeReq struct {
	SourceID string `json:"source_id"`
	TargetID string `json:"target_id"`
	Kind     string `json:"kind"`
}

func (h *handler) createEdge(w http.ResponseWriter, r *http.Request) {
	var req createEdgeReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "invalid body", 400)
		return
	}
	if req.SourceID == "" || req.TargetID == "" {
		http.Error(w, "source_id and target_id required", 400)
		return
	}
	if req.SourceID == req.TargetID {
		http.Error(w, "self-loop not allowed", 400)
		return
	}
	if req.Kind == "" {
		req.Kind = "blocks"
	}
	if req.Kind != "blocks" && req.Kind != "subtask" {
		http.Error(w, "kind must be 'blocks' or 'subtask'", 400)
		return
	}

	ctx := r.Context()
	hasCycle, err := h.db.HasCycle(ctx, req.SourceID, req.TargetID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if hasCycle {
		http.Error(w, "cycle detected", 409)
		return
	}

	edge := models.TaskEdge{
		ID:        fmt.Sprintf("e-%d", time.Now().UnixNano()),
		SourceID:  req.SourceID,
		TargetID:  req.TargetID,
		Kind:      req.Kind,
		CreatedAt: time.Now().Unix(),
	}
	if err := h.db.CreateEdge(ctx, edge); err != nil {
		// UNIQUE constraint = already exists
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "edge already exists", 409)
			return
		}
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 201, edge)
}

func (h *handler) deleteEdge(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.DeleteEdge(r.Context(), id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

func (h *handler) getTaskNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	note, err := h.db.GetTaskNote(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, note)
}

type upsertNoteReq struct {
	Content string `json:"content"`
}

func (h *handler) upsertTaskNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req upsertNoteReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "invalid body", 400)
		return
	}
	note, err := h.db.UpsertTaskNote(r.Context(), id, req.Content)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, note)
}

func (h *handler) getReadyTasks(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if day == "" {
		day = today()
	}
	ids, err := h.db.ReadyTaskIDs(r.Context(), day)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if ids == nil {
		ids = []string{}
	}
	writeJSON(w, 200, map[string][]string{"ready": ids})
}
