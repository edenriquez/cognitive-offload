package store

import (
	"context"
	"testing"
	"time"

	"github.com/cogload/backend/internal/models"
)

// newTestDB returns an in-memory SQLite store with the schema applied.
func newTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	if err := db.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

func TestCreateAndGetTask(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	task := models.Task{
		ID:   "task-1",
		Day:  day,
		Kind: "must",
		Idx:  1,
		Text: "Ship the feature",
		Done: false,
	}

	if err := db.CreateTask(ctx, task); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	tasks, err := db.TasksByDay(ctx, day)
	if err != nil {
		t.Fatalf("TasksByDay: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(tasks))
	}

	got := tasks[0]
	if got.ID != task.ID {
		t.Errorf("ID = %q, want %q", got.ID, task.ID)
	}
	if got.Text != task.Text {
		t.Errorf("Text = %q, want %q", got.Text, task.Text)
	}
	if got.Kind != task.Kind {
		t.Errorf("Kind = %q, want %q", got.Kind, task.Kind)
	}
	if got.Idx != task.Idx {
		t.Errorf("Idx = %d, want %d", got.Idx, task.Idx)
	}
	if got.Done {
		t.Error("Done should be false")
	}
	if got.Day != day {
		t.Errorf("Day = %q, want %q", got.Day, day)
	}
}

func TestToggleTask(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	task := models.Task{
		ID: "task-toggle", Day: day, Kind: "must", Idx: 1,
		Text: "Write tests", Done: false,
	}
	if err := db.CreateTask(ctx, task); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	// Toggle: false → true
	if err := db.ToggleTask(ctx, task.ID); err != nil {
		t.Fatalf("ToggleTask (1st): %v", err)
	}

	tasks, _ := db.TasksByDay(ctx, day)
	if len(tasks) != 1 || !tasks[0].Done {
		t.Error("expected task to be done after first toggle")
	}

	// Toggle: true → false
	if err := db.ToggleTask(ctx, task.ID); err != nil {
		t.Fatalf("ToggleTask (2nd): %v", err)
	}

	tasks, _ = db.TasksByDay(ctx, day)
	if len(tasks) != 1 || tasks[0].Done {
		t.Error("expected task to be not-done after second toggle")
	}
}

func TestDeleteTask(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	task := models.Task{
		ID: "task-del", Day: day, Kind: "personal", Idx: 1,
		Text: "Ephemeral task", Done: false,
	}
	if err := db.CreateTask(ctx, task); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	if err := db.DeleteTask(ctx, task.ID); err != nil {
		t.Fatalf("DeleteTask: %v", err)
	}

	tasks, _ := db.TasksByDay(ctx, day)
	if len(tasks) != 0 {
		t.Errorf("expected 0 tasks after delete, got %d", len(tasks))
	}
}

func TestUpdateTask(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	task := models.Task{
		ID: "task-upd", Day: day, Kind: "must", Idx: 1,
		Text: "Original text", Done: false,
	}
	if err := db.CreateTask(ctx, task); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	if err := db.UpdateTask(ctx, task.ID, "Updated text", "personal", 2); err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}

	tasks, _ := db.TasksByDay(ctx, day)
	if len(tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(tasks))
	}
	if tasks[0].Text != "Updated text" {
		t.Errorf("Text = %q, want %q", tasks[0].Text, "Updated text")
	}
	if tasks[0].Kind != "personal" {
		t.Errorf("Kind = %q, want %q", tasks[0].Kind, "personal")
	}
	if tasks[0].Idx != 2 {
		t.Errorf("Idx = %d, want %d", tasks[0].Idx, 2)
	}
}

func TestNextTaskIdx(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	// No tasks yet — should return 1
	idx, err := db.NextTaskIdx(ctx, day, "must")
	if err != nil {
		t.Fatalf("NextTaskIdx: %v", err)
	}
	if idx != 1 {
		t.Errorf("expected 1, got %d", idx)
	}

	// Add a task with idx=3
	db.CreateTask(ctx, models.Task{ID: "t1", Day: day, Kind: "must", Idx: 3, Text: "x"})

	idx, _ = db.NextTaskIdx(ctx, day, "must")
	if idx != 4 {
		t.Errorf("expected 4, got %d", idx)
	}
}

func TestReorderTasks(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	db.CreateTask(ctx, models.Task{ID: "t-a", Day: day, Kind: "must", Idx: 1, Text: "A"})
	db.CreateTask(ctx, models.Task{ID: "t-b", Day: day, Kind: "must", Idx: 2, Text: "B"})
	db.CreateTask(ctx, models.Task{ID: "t-c", Day: day, Kind: "must", Idx: 3, Text: "C"})

	// Reverse order
	err := db.ReorderTasks(ctx, []models.TaskOrder{
		{ID: "t-a", Idx: 3},
		{ID: "t-b", Idx: 2},
		{ID: "t-c", Idx: 1},
	})
	if err != nil {
		t.Fatalf("ReorderTasks: %v", err)
	}

	tasks, _ := db.TasksByDay(ctx, day)
	// Tasks are ordered by kind, idx — so C(1) should come first
	if len(tasks) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(tasks))
	}
	if tasks[0].ID != "t-c" {
		t.Errorf("first task should be t-c (idx 1), got %s (idx %d)", tasks[0].ID, tasks[0].Idx)
	}
	if tasks[2].ID != "t-a" {
		t.Errorf("last task should be t-a (idx 3), got %s (idx %d)", tasks[2].ID, tasks[2].Idx)
	}
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

func TestCreateAndListCaptures(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	now := time.Now()
	captures := []models.Capture{
		{ID: "cap-1", Text: "First thought", CreatedAt: now.Add(-2 * time.Second)},
		{ID: "cap-2", Text: "Second thought", CreatedAt: now.Add(-1 * time.Second)},
		{ID: "cap-3", Text: "Third thought", CreatedAt: now},
	}

	for _, c := range captures {
		if err := db.InsertCapture(ctx, c); err != nil {
			t.Fatalf("InsertCapture(%s): %v", c.ID, err)
		}
	}

	// RecentCaptures returns newest first
	result, err := db.RecentCaptures(ctx, 10)
	if err != nil {
		t.Fatalf("RecentCaptures: %v", err)
	}
	if len(result) != 3 {
		t.Fatalf("expected 3 captures, got %d", len(result))
	}

	// Newest first
	if result[0].ID != "cap-3" {
		t.Errorf("first capture should be cap-3 (newest), got %s", result[0].ID)
	}
	if result[2].ID != "cap-1" {
		t.Errorf("last capture should be cap-1 (oldest), got %s", result[2].ID)
	}
}

func TestCreateAndListCaptures_LimitRespected(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	now := time.Now()
	for i := 0; i < 5; i++ {
		db.InsertCapture(ctx, models.Capture{
			ID:        "cap-" + string(rune('a'+i)),
			Text:      "thought",
			CreatedAt: now.Add(time.Duration(i) * time.Second),
		})
	}

	result, _ := db.RecentCaptures(ctx, 2)
	if len(result) != 2 {
		t.Errorf("expected 2 captures with limit=2, got %d", len(result))
	}
}

func TestDeleteCapture(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	cap := models.Capture{
		ID: "cap-del", Text: "Delete me", CreatedAt: time.Now(),
	}
	if err := db.InsertCapture(ctx, cap); err != nil {
		t.Fatalf("InsertCapture: %v", err)
	}

	// Verify it exists
	got, err := db.GetCapture(ctx, cap.ID)
	if err != nil {
		t.Fatalf("GetCapture: %v", err)
	}
	if got == nil {
		t.Fatal("capture should exist before delete")
	}

	if err := db.DeleteCapture(ctx, cap.ID); err != nil {
		t.Fatalf("DeleteCapture: %v", err)
	}

	got, err = db.GetCapture(ctx, cap.ID)
	if err != nil {
		t.Fatalf("GetCapture after delete: %v", err)
	}
	if got != nil {
		t.Error("capture should be nil after delete")
	}
}

func TestGetCapture_NotFound(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	got, err := db.GetCapture(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("GetCapture: %v", err)
	}
	if got != nil {
		t.Error("expected nil for nonexistent capture")
	}
}

// ---------------------------------------------------------------------------
// Focus Sessions
// ---------------------------------------------------------------------------

func TestFocusSessionLifecycle(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	started := time.Now().Add(-30 * time.Minute)
	fs := models.FocusSession{
		ID:        "fs-1",
		TaskID:    "task-1",
		TaskText:  "Deep work session",
		StartedAt: started,
		Outcome:   "active",
	}

	if err := db.StartFocusSession(ctx, fs); err != nil {
		t.Fatalf("StartFocusSession: %v", err)
	}

	// Should be the active session
	active, err := db.ActiveFocusSession(ctx)
	if err != nil {
		t.Fatalf("ActiveFocusSession: %v", err)
	}
	if active == nil {
		t.Fatal("expected an active focus session")
	}
	if active.ID != fs.ID {
		t.Errorf("active session ID = %q, want %q", active.ID, fs.ID)
	}
	if active.TaskText != fs.TaskText {
		t.Errorf("TaskText = %q, want %q", active.TaskText, fs.TaskText)
	}
	if active.Outcome != "active" {
		t.Errorf("Outcome = %q, want %q", active.Outcome, "active")
	}

	// Stop the session
	if err := db.StopFocusSession(ctx, fs.ID, "completed"); err != nil {
		t.Fatalf("StopFocusSession: %v", err)
	}

	// Should no longer be active
	active, err = db.ActiveFocusSession(ctx)
	if err != nil {
		t.Fatalf("ActiveFocusSession after stop: %v", err)
	}
	if active != nil {
		t.Error("expected no active focus session after stop")
	}
}

func TestFocusSessionsByDay(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	day := "2025-01-15"
	dayStart, _ := time.Parse("2006-01-02", day)

	fs1 := models.FocusSession{
		ID: "fs-day-1", TaskID: "t1", TaskText: "Morning work",
		StartedAt: dayStart.Add(2 * time.Hour), Outcome: "active",
	}
	fs2 := models.FocusSession{
		ID: "fs-day-2", TaskID: "t2", TaskText: "Afternoon work",
		StartedAt: dayStart.Add(6 * time.Hour), Outcome: "active",
	}

	db.StartFocusSession(ctx, fs1)
	db.StartFocusSession(ctx, fs2)

	sessions, err := db.FocusSessionsByDay(ctx, day)
	if err != nil {
		t.Fatalf("FocusSessionsByDay: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 focus sessions, got %d", len(sessions))
	}
	// Should be ordered by started_at
	if sessions[0].ID != "fs-day-1" {
		t.Errorf("first session should be fs-day-1, got %s", sessions[0].ID)
	}
}

func TestActiveFocusMinutes(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	// No active session — should return 0
	mins, err := db.ActiveFocusMinutes(ctx)
	if err != nil {
		t.Fatalf("ActiveFocusMinutes: %v", err)
	}
	if mins != 0 {
		t.Errorf("expected 0 minutes with no active session, got %d", mins)
	}

	// Start a session 10 minutes ago
	fs := models.FocusSession{
		ID: "fs-minutes", TaskID: "t1", TaskText: "Timed work",
		StartedAt: time.Now().Add(-10 * time.Minute), Outcome: "active",
	}
	db.StartFocusSession(ctx, fs)

	mins, _ = db.ActiveFocusMinutes(ctx)
	// Allow ±1 minute tolerance
	if mins < 9 || mins > 11 {
		t.Errorf("expected ~10 minutes, got %d", mins)
	}
}

// ---------------------------------------------------------------------------
// Sessions (LLM threads)
// ---------------------------------------------------------------------------

func TestCreateAndListSessions(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	s1 := models.Session{
		ID: "sess-1", Label: "Debug auth", StartedAt: time.Now().Add(-1 * time.Hour),
		MessageCount: 5, ErrorCount: 0, Status: "open", Day: day,
	}
	s2 := models.Session{
		ID: "sess-2", Label: "Fix CSS", StartedAt: time.Now().Add(-30 * time.Minute),
		MessageCount: 3, ErrorCount: 1, Status: "closed", Day: day,
	}

	if err := db.CreateSession(ctx, s1); err != nil {
		t.Fatalf("CreateSession(s1): %v", err)
	}
	if err := db.CreateSession(ctx, s2); err != nil {
		t.Fatalf("CreateSession(s2): %v", err)
	}

	sessions, err := db.SessionsByDay(ctx, day)
	if err != nil {
		t.Fatalf("SessionsByDay: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestUpdateSession(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	s := models.Session{
		ID: "sess-upd", Label: "Original", StartedAt: time.Now(),
		MessageCount: 1, Status: "open", Day: day,
	}
	db.CreateSession(ctx, s)

	if err := db.UpdateSession(ctx, s.ID, "Renamed", "stalled"); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	sessions, _ := db.SessionsByDay(ctx, day)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].Label != "Renamed" {
		t.Errorf("Label = %q, want %q", sessions[0].Label, "Renamed")
	}
	if sessions[0].Status != "stalled" {
		t.Errorf("Status = %q, want %q", sessions[0].Status, "stalled")
	}
}

func TestIncrementSessionMessages(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	s := models.Session{
		ID: "sess-inc", Label: "Chat", StartedAt: time.Now(),
		MessageCount: 0, Status: "open", Day: day,
	}
	db.CreateSession(ctx, s)

	db.IncrementSessionMessages(ctx, s.ID)
	db.IncrementSessionMessages(ctx, s.ID)
	db.IncrementSessionMessages(ctx, s.ID)

	sessions, _ := db.SessionsByDay(ctx, day)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].MessageCount != 3 {
		t.Errorf("MessageCount = %d, want 3", sessions[0].MessageCount)
	}
}

func TestOpenSessions(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	db.CreateSession(ctx, models.Session{
		ID: "s-open", Label: "Open one", StartedAt: time.Now(),
		Status: "open", Day: day,
	})
	db.CreateSession(ctx, models.Session{
		ID: "s-closed", Label: "Closed one", StartedAt: time.Now(),
		Status: "closed", Day: day,
	})
	db.CreateSession(ctx, models.Session{
		ID: "s-stalled", Label: "Stalled one", StartedAt: time.Now(),
		Status: "stalled", Day: day,
	})

	open, err := db.OpenSessions(ctx, day)
	if err != nil {
		t.Fatalf("OpenSessions: %v", err)
	}

	// OpenSessions should return sessions that are open or stalled
	// Let's check what comes back
	for _, s := range open {
		if s.Status != "open" && s.Status != "stalled" {
			t.Errorf("OpenSessions returned session with status %q", s.Status)
		}
	}
}

func TestSessionCountSince(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	now := time.Now()
	db.CreateSession(ctx, models.Session{
		ID: "s-recent", Label: "Recent", StartedAt: now.Add(-5 * time.Minute),
		Status: "open", Day: day,
	})
	db.CreateSession(ctx, models.Session{
		ID: "s-old", Label: "Old", StartedAt: now.Add(-30 * time.Minute),
		Status: "open", Day: day,
	})

	tenMinAgo := now.Add(-10 * time.Minute).Unix()
	count, err := db.SessionCountSince(ctx, day, tenMinAgo)
	if err != nil {
		t.Fatalf("SessionCountSince: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 session since 10min ago, got %d", count)
	}
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

func TestInsertAndQueryEvents(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	now := time.Now()
	day := now.Format("2006-01-02") // InsertEvents derives day from Timestamp
	events := []models.RawEvent{
		{Timestamp: now.Add(-5 * time.Minute), Source: "editor", Kind: "file_save", Day: day},
		{Timestamp: now.Add(-3 * time.Minute), Source: "editor", Kind: "file_save", Day: day},
		{Timestamp: now.Add(-1 * time.Minute), Source: "editor", Kind: "error", Day: day},
	}

	if err := db.InsertEvents(ctx, events); err != nil {
		t.Fatalf("InsertEvents: %v", err)
	}

	start := now.Add(-10 * time.Minute).UnixMilli()
	end := now.UnixMilli()
	result, err := db.QueryEventsInWindow(ctx, day, start, end)
	if err != nil {
		t.Fatalf("QueryEventsInWindow: %v", err)
	}

	if result["file_save"] != 2 {
		t.Errorf("file_save count = %d, want 2", result["file_save"])
	}
	if result["error"] != 1 {
		t.Errorf("error count = %d, want 1", result["error"])
	}
}

func TestRecentEventCount(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	now := time.Now()
	day := now.Format("2006-01-02")
	events := []models.RawEvent{
		{Timestamp: now.Add(-5 * time.Minute), Source: "editor", Kind: "error", Day: day},
		{Timestamp: now.Add(-3 * time.Minute), Source: "editor", Kind: "error", Day: day},
		{Timestamp: now.Add(-1 * time.Minute), Source: "editor", Kind: "file_save", Day: day},
	}
	db.InsertEvents(ctx, events)

	sinceMs := now.Add(-10 * time.Minute).UnixMilli()
	count, err := db.RecentEventCount(ctx, day, "error", sinceMs)
	if err != nil {
		t.Fatalf("RecentEventCount: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 errors, got %d", count)
	}
}

func TestLastEventTimestamp(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()

	now := time.Now()
	day := now.Format("2006-01-02")

	// No events — should return 0
	ts, err := db.LastEventTimestamp(ctx, day)
	if err != nil {
		t.Fatalf("LastEventTimestamp: %v", err)
	}
	if ts != 0 {
		t.Errorf("expected 0 for no events, got %d", ts)
	}

	// Insert events
	events := []models.RawEvent{
		{Timestamp: now.Add(-5 * time.Minute), Source: "editor", Kind: "file_save", Day: day},
		{Timestamp: now.Add(-1 * time.Minute), Source: "editor", Kind: "file_save", Day: day},
	}
	db.InsertEvents(ctx, events)

	ts, _ = db.LastEventTimestamp(ctx, day)
	if ts == 0 {
		t.Error("expected non-zero timestamp after inserting events")
	}

	// Should be close to the most recent event
	lastEvent := now.Add(-1 * time.Minute).UnixMilli()
	diff := ts - lastEvent
	if diff < -1000 || diff > 1000 { // within 1 second
		t.Errorf("timestamp diff from expected is too large: %d ms", diff)
	}
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

func TestUpsertAndGetBuckets(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	bucket := models.Bucket{
		Day: day, BucketIdx: 60, Hour: 10.0,
		Activity: 75, Errors: 2, Sessions: 1, FileSaves: 10, IdleSec: 30,
	}
	if err := db.UpsertBucket(ctx, bucket); err != nil {
		t.Fatalf("UpsertBucket: %v", err)
	}

	buckets, err := db.BucketsByDay(ctx, day)
	if err != nil {
		t.Fatalf("BucketsByDay: %v", err)
	}
	if len(buckets) != 1 {
		t.Fatalf("expected 1 bucket, got %d", len(buckets))
	}

	got := buckets[0]
	if got.Activity != 75 {
		t.Errorf("Activity = %d, want 75", got.Activity)
	}
	if got.Errors != 2 {
		t.Errorf("Errors = %d, want 2", got.Errors)
	}
	if got.Hour != 10.0 {
		t.Errorf("Hour = %f, want 10.0", got.Hour)
	}
}

func TestBucketsInRange(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	// Insert buckets at different hours
	db.UpsertBucket(ctx, models.Bucket{Day: day, BucketIdx: 54, Hour: 9.0, Activity: 50})
	db.UpsertBucket(ctx, models.Bucket{Day: day, BucketIdx: 60, Hour: 10.0, Activity: 70})
	db.UpsertBucket(ctx, models.Bucket{Day: day, BucketIdx: 84, Hour: 14.0, Activity: 40})

	// Query range 9.0 to 11.0
	buckets, err := db.BucketsInRange(ctx, day, 9.0, 11.0)
	if err != nil {
		t.Fatalf("BucketsInRange: %v", err)
	}
	if len(buckets) != 2 {
		t.Errorf("expected 2 buckets in range [9,11), got %d", len(buckets))
	}
}

func TestRecentBuckets(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	db.UpsertBucket(ctx, models.Bucket{Day: day, BucketIdx: 1, Hour: 0.17, Activity: 10})
	db.UpsertBucket(ctx, models.Bucket{Day: day, BucketIdx: 2, Hour: 0.33, Activity: 20})
	db.UpsertBucket(ctx, models.Bucket{Day: day, BucketIdx: 3, Hour: 0.50, Activity: 30})

	buckets, err := db.RecentBuckets(ctx, day, 2)
	if err != nil {
		t.Fatalf("RecentBuckets: %v", err)
	}
	if len(buckets) != 2 {
		t.Fatalf("expected 2 buckets, got %d", len(buckets))
	}
	// Should be ordered by bucket_idx DESC
	if buckets[0].BucketIdx != 3 {
		t.Errorf("first bucket should be idx 3 (most recent), got %d", buckets[0].BucketIdx)
	}
}

// ---------------------------------------------------------------------------
// UpsertSession (ON CONFLICT behaviour)
// ---------------------------------------------------------------------------

func TestUpsertSession(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	s := models.Session{
		ID: "sess-upsert", Label: "First", StartedAt: time.Now(),
		MessageCount: 1, ErrorCount: 0, Status: "open", Day: day,
	}
	if err := db.UpsertSession(ctx, s); err != nil {
		t.Fatalf("UpsertSession (insert): %v", err)
	}

	// Update via upsert
	s.Label = "Updated"
	s.MessageCount = 5
	s.Status = "closed"
	if err := db.UpsertSession(ctx, s); err != nil {
		t.Fatalf("UpsertSession (update): %v", err)
	}

	sessions, _ := db.SessionsByDay(ctx, day)
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session after upsert, got %d", len(sessions))
	}
	if sessions[0].Label != "Updated" {
		t.Errorf("Label = %q, want %q", sessions[0].Label, "Updated")
	}
	if sessions[0].MessageCount != 5 {
		t.Errorf("MessageCount = %d, want 5", sessions[0].MessageCount)
	}
	if sessions[0].Status != "closed" {
		t.Errorf("Status = %q, want %q", sessions[0].Status, "closed")
	}
}

// ---------------------------------------------------------------------------
// Self Reports
// ---------------------------------------------------------------------------

func TestSelfReports(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	now := time.Now()
	if err := db.InsertSelfReport(ctx, day, 3, "loaded", now.UnixMilli(), 60, "feeling heavy"); err != nil {
		t.Fatalf("InsertSelfReport: %v", err)
	}
	if err := db.InsertSelfReport(ctx, day, 5, "degraded", now.Add(10*time.Minute).UnixMilli(), 61, ""); err != nil {
		t.Fatalf("InsertSelfReport (2): %v", err)
	}

	reports, err := db.SelfReportsByDay(ctx, day)
	if err != nil {
		t.Fatalf("SelfReportsByDay: %v", err)
	}
	if len(reports) != 2 {
		t.Fatalf("expected 2 reports, got %d", len(reports))
	}
	if reports[0].Level != 3 {
		t.Errorf("first report level = %d, want 3", reports[0].Level)
	}
	if reports[0].Note != "feeling heavy" {
		t.Errorf("first report note = %q, want %q", reports[0].Note, "feeling heavy")
	}
	if reports[1].Label != "degraded" {
		t.Errorf("second report label = %q, want %q", reports[1].Label, "degraded")
	}
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

func TestInsertAndListPatterns(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	day := "2025-01-15"

	p := models.Pattern{
		ID: "pat-1", Day: day, Kind: "perf-degradation", Severity: "high",
		Title: "Too many threads", Detail: "5 threads in 10 min",
		Window: "09:00-09:10", Evidence: map[string]any{"threads": 5},
		DetectedAt: time.Now(),
	}
	if err := db.InsertPattern(ctx, p); err != nil {
		t.Fatalf("InsertPattern: %v", err)
	}

	patterns, err := db.PatternsByDay(ctx, day)
	if err != nil {
		t.Fatalf("PatternsByDay: %v", err)
	}
	if len(patterns) != 1 {
		t.Fatalf("expected 1 pattern, got %d", len(patterns))
	}
	if patterns[0].Kind != "perf-degradation" {
		t.Errorf("Kind = %q, want %q", patterns[0].Kind, "perf-degradation")
	}
}

// ---------------------------------------------------------------------------
// Migrate is idempotent
// ---------------------------------------------------------------------------

func TestMigrateIdempotent(t *testing.T) {
	db := newTestDB(t)

	// Second migration should succeed without error
	if err := db.Migrate(); err != nil {
		t.Fatalf("second Migrate() failed: %v", err)
	}
}
