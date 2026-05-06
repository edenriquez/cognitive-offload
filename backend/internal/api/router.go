package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/cogload/backend/internal/engine"
	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
	"github.com/cogload/backend/internal/ws"
)

func NewRouter(db *store.DB, hub *ws.Hub, eng *engine.Engine) http.Handler {
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

	h := &handler{db: db, hub: hub, eng: eng}

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

		// Reset
		r.Post("/reset", h.resetDB)
	})

	return r
}

type handler struct {
	db  *store.DB
	hub *ws.Hub
	eng *engine.Engine
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

	buckets, _ := h.db.BucketsByDay(ctx, day)
	if buckets == nil {
		buckets = []models.Bucket{}
	}

	patterns, _ := h.db.PatternsByDay(ctx, day)
	if patterns == nil {
		patterns = []models.Pattern{}
	}

	sessions, _ := h.db.SessionsByDay(ctx, day)
	if sessions == nil {
		sessions = []models.Session{}
	}

	openLoops := 0
	for _, s := range sessions {
		if s.Status != "closed" {
			openLoops++
		}
	}

	leaks := []models.Leak{
		{Time: "13:30–14:30", Cost: "−1h 04m", Cause: "Post-lunch crash", Fix: "Move deep block to 11:00"},
		{Time: "14:30–15:00", Cost: "−27m", Cause: "Session thrashing", Fix: "Cap at 1 active thread"},
		{Time: "14:38–14:42", Cost: "−4m × 5", Cause: "Cold-start errors", Fix: "Pre-flight checklist"},
		{Time: "17:15–18:30", Cost: "quality", Cause: "Fatigue work", Fix: "Hard stop at 16:30"},
	}

	rootCauses := []models.RootCause{
		{Signal: "7 sessions / 30m", Cause: "No active-thread cap → context-switch tax", Confidence: 92},
		{Signal: "−62% post-lunch dip", Cause: "Heavy lunch + immediate cognitive load", Confidence: 78},
		{Signal: "+180% error spike", Cause: "Working past cutoff under fatigue", Confidence: 88},
		{Signal: "3 open threads", Cause: "No close-or-archive enforcement", Confidence: 85},
	}

	review := models.ReviewSummary{
		Summary: models.DaySummary{
			DeepWorkMin:   227,
			LeakedMin:     95,
			OpenLoops:     openLoops,
			SessionsCount: len(sessions),
		},
		EnergyMap:  buckets,
		Patterns:   patterns,
		Leaks:      leaks,
		RootCauses: rootCauses,
		Sessions:   sessions,
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
		// No plan exists — return an empty draft, don't auto-create fake tasks
		plan = &models.Plan{
			Day:         day,
			Status:      "draft",
			Headline:    "No plan yet. Review today first, or create tasks manually.",
			Constraints: []models.Constraint{},
			Bandwidth:   models.Bandwidth{Work: 60, Personal: 15, Admin: 15, Learning: 10},
			Tasks:       []models.Task{},
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

// ---------- Reset ----------

func (h *handler) resetDB(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.db.ResetAll(ctx); err != nil {
		slog.Error("reset failed", "error", err)
		http.Error(w, "internal error", 500)
		return
	}
	slog.Info("database reset via API")
	writeJSON(w, 200, map[string]string{"status": "reset"})
}

// Suppress unused import warning
var _ = math.Min
