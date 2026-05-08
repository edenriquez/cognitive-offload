package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
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
		AllowedOrigins:   []string{"http://localhost:*", "http://127.0.0.1:*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
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

		// Tomorrow
		r.Get("/tomorrow", h.getTomorrow)
		r.Post("/tomorrow/lock", h.lockTomorrow)
		r.Put("/tomorrow", h.updateTomorrow)
		r.Post("/tomorrow/regenerate", h.regenerateTomorrow)
		r.Post("/tomorrow/rollover", h.rolloverTomorrow)

		// Sessions
		r.Get("/sessions", h.listSessions)
		r.Post("/sessions/{id}/close", h.closeSession)
		r.Post("/sessions", h.createSession)
		r.Put("/sessions/{id}", h.updateSession)

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

	writeJSON(w, 200, review)
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

func (h *handler) listSessions(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("day")
	if day == "" {
		day = today()
	}
	sessions, err := h.db.SessionsByDay(r.Context(), day)
	if err != nil {
		slog.Error("list sessions", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	if sessions == nil {
		sessions = []models.Session{}
	}
	writeJSON(w, 200, sessions)
}

func (h *handler) closeSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.db.CloseSession(r.Context(), id); err != nil {
		slog.Error("close session", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "closed"})
}

type createSessionReq struct {
	Label string `json:"label"`
}

func (h *handler) createSession(w http.ResponseWriter, r *http.Request) {
	var req createSessionReq
	if err := readJSON(r, &req); err != nil || req.Label == "" {
		http.Error(w, "bad request", 400)
		return
	}
	s := models.Session{
		ID:        fmt.Sprintf("s-%d", time.Now().UnixNano()),
		Label:     req.Label,
		StartedAt: time.Now(),
		Status:    "open",
		Day:       today(),
	}
	if err := h.db.CreateSession(r.Context(), s); err != nil {
		slog.Error("create session", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 201, s)
}

type updateSessionReq struct {
	Label  string `json:"label"`
	Status string `json:"status"`
}

func (h *handler) updateSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateSessionReq
	if err := readJSON(r, &req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if err := h.db.UpdateSession(r.Context(), id, req.Label, req.Status); err != nil {
		slog.Error("update session", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "updated"})
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

// Suppress unused import warning
var _ = math.Min
