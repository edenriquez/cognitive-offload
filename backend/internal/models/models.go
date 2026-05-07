package models

import "time"

// RawEvent is an append-only log entry from any data source.
type RawEvent struct {
	ID        int64          `json:"id"`
	Timestamp time.Time      `json:"timestamp"`
	Source    string         `json:"source"` // editor | llm | git | terminal | system
	Kind      string         `json:"kind"`   // file_save | session_start | error | etc.
	Metadata  map[string]any `json:"metadata"`
	Day       string         `json:"day"` // YYYY-MM-DD
}

// Session tracks an LLM conversation thread lifecycle.
type Session struct {
	ID           string     `json:"id"`
	Label        string     `json:"label"`
	StartedAt    time.Time  `json:"started_at"`
	EndedAt      *time.Time `json:"ended_at,omitempty"`
	MessageCount int        `json:"message_count"`
	ErrorCount   int        `json:"error_count"`
	Status       string     `json:"status"` // open | closed | stalled | orphan
	Day          string     `json:"day"`
}

// Bucket is a pre-aggregated 10-minute window.
type Bucket struct {
	Day       string  `json:"day"`
	BucketIdx int     `json:"bucket_idx"` // 0-143
	Hour      float64 `json:"hour"`       // e.g. 14.5
	Activity  int     `json:"activity"`   // 0-100 density
	Errors    int     `json:"errors"`
	Sessions  int     `json:"sessions"`
	FileSaves int     `json:"file_saves"`
	IdleSec   int     `json:"idle_sec"`
}

// Pattern is a detected behavioral signal.
type Pattern struct {
	ID         string         `json:"id"`
	Day        string         `json:"day"`
	Kind       string         `json:"kind"`     // perf-degradation | crash | stuck | fatigue | cold-start | open-loops | overwork
	Severity   string         `json:"severity"` // high | medium | low
	Title      string         `json:"title"`
	Detail     string         `json:"detail"`
	Window     string         `json:"window"`
	Evidence   map[string]any `json:"evidence"`
	DetectedAt time.Time      `json:"detected_at"`
}

// Task is a daily must-win or personal item.
type Task struct {
	ID   string `json:"id"`
	Day  string `json:"day"`
	Kind string `json:"kind"` // must | personal | small
	Idx  int    `json:"idx"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// Plan is an auto-generated daily plan.
type Plan struct {
	Day         string       `json:"day"`
	Status      string       `json:"status"` // draft | locked | completed
	Headline    string       `json:"headline"`
	Constraints []Constraint `json:"constraints"`
	Bandwidth   Bandwidth    `json:"bandwidth"`
	Tasks       []Task       `json:"tasks"`
	GeneratedAt *time.Time   `json:"generated_at,omitempty"`
	LockedAt    *time.Time   `json:"locked_at,omitempty"`
}

type Constraint struct {
	Rule        string `json:"rule"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Locked      bool   `json:"locked"`
}

type Bandwidth struct {
	Work     int `json:"work"`
	Personal int `json:"personal"`
	Admin    int `json:"admin"`
	Learning int `json:"learning"`
}

// TaskOrder is used for reordering tasks.
type TaskOrder struct {
	ID  string `json:"id"`
	Idx int    `json:"idx"`
}

// FocusSession tracks a timed focus period on a task.
type FocusSession struct {
	ID          string     `json:"id"`
	TaskID      string     `json:"task_id"`
	TaskText    string     `json:"task_text"`
	StartedAt   time.Time  `json:"started_at"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
	DurationSec int        `json:"duration_sec"`
	Outcome     string     `json:"outcome"` // active | completed | cancelled | paused
}

// Capture is a brain-dump item.
type Capture struct {
	ID        string    `json:"id"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"created_at"`
}

// Leak represents an energy leak in a daily review.
type Leak struct {
	Time  string `json:"time"`
	Cost  string `json:"cost"`
	Cause string `json:"cause"`
	Fix   string `json:"fix"`
}

// RootCause is an auto-detected root cause.
type RootCause struct {
	Signal     string `json:"signal"`
	Cause      string `json:"cause"`
	Confidence int    `json:"confidence"`
}

// Intervention is a rule-triggered action.
type Intervention struct {
	ID       string   `json:"id"`
	Severity string   `json:"severity"` // block | warn | info
	Rule     string   `json:"rule"`
	Title    string   `json:"title"`
	Body     string   `json:"body"`
	Evidence []string `json:"evidence"`
	Action   Action   `json:"action"`
	Action2  *Action  `json:"action2,omitempty"`
}

type Action struct {
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

// SignalSnapshot is pushed via WebSocket every 5s.
type SignalSnapshot struct {
	FocusState      string         `json:"focus_state"`
	ActiveThreads   int            `json:"active_threads"`
	ErrorRate       float64        `json:"error_rate"`
	ErrorBaseline   float64        `json:"error_baseline"`
	OpenLoops       int            `json:"open_loops"`
	CutoffHour      float64        `json:"cutoff_hour"`
	CogThresholdPct int            `json:"cognitive_threshold_pct"`
	Interventions   []Intervention `json:"interventions"`
	ActiveSession   *SessionBrief  `json:"active_session,omitempty"`
}

type SessionBrief struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	DurationMin     int    `json:"duration_min"`
	LastTouchAgoSec int    `json:"last_touch_ago_sec"`
}

// ReviewSummary is a full daily audit payload.
type ReviewSummary struct {
	Summary     DaySummary   `json:"summary"`
	EnergyMap   []Bucket     `json:"energy_map"`
	Patterns    []Pattern    `json:"patterns"`
	Leaks       []Leak       `json:"leaks"`
	RootCauses  []RootCause  `json:"root_causes"`
	Sessions    []Session    `json:"sessions"`
	SelfReports []SelfReport `json:"self_reports"`
}

type DaySummary struct {
	DeepWorkMin   int `json:"deep_work_min"`
	LeakedMin     int `json:"leaked_min"`
	OpenLoops     int `json:"open_loops"`
	SessionsCount int `json:"sessions_count"`
}

// SelfReport is a user-reported subjective cognitive state.
type SelfReport struct {
	ID        int    `json:"id"`
	Day       string `json:"day"`
	Level     int    `json:"level"`      // 1-5: fresh, focused, loaded, tired, degraded
	Label     string `json:"label"`      // Human label for the level
	Ts        int64  `json:"ts"`         // Unix milliseconds
	BucketIdx int    `json:"bucket_idx"` // Which 10-min bucket this falls in
	Note      string `json:"note"`       // Optional free-text note
}

// TodayResponse bundles everything the Today view needs.
type TodayResponse struct {
	Tasks        []Task        `json:"tasks"`
	Bandwidth    Bandwidth     `json:"bandwidth"`
	ActiveThread *SessionBrief `json:"active_thread,omitempty"`
	Greet        string        `json:"greet"`
	Completed    int           `json:"completed"`
	Total        int           `json:"total"`
}
