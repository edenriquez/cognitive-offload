package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/cogload/backend/internal/models"
)

type DB struct {
	db *sql.DB
}

func Open(path string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	sqlDB.SetMaxOpenConns(1) // SQLite is single-writer
	sqlDB.SetMaxIdleConns(2)
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &DB{db: sqlDB}, nil
}

func (d *DB) Close() error { return d.db.Close() }

func (d *DB) Migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS raw_events (
		id        INTEGER PRIMARY KEY AUTOINCREMENT,
		ts        INTEGER NOT NULL,
		source    TEXT NOT NULL,
		kind      TEXT NOT NULL,
		metadata  TEXT NOT NULL DEFAULT '{}',
		day       TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_events_day_ts ON raw_events(day, ts);

	CREATE TABLE IF NOT EXISTS sessions (
		id            TEXT PRIMARY KEY,
		label         TEXT NOT NULL DEFAULT '',
		started_at    INTEGER NOT NULL,
		ended_at      INTEGER,
		message_count INTEGER NOT NULL DEFAULT 0,
		error_count   INTEGER NOT NULL DEFAULT 0,
		status        TEXT NOT NULL DEFAULT 'open',
		day           TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);

	CREATE TABLE IF NOT EXISTS buckets (
		day        TEXT NOT NULL,
		bucket_idx INTEGER NOT NULL,
		hour       REAL NOT NULL,
		activity   INTEGER NOT NULL DEFAULT 0,
		errors     INTEGER NOT NULL DEFAULT 0,
		sessions   INTEGER NOT NULL DEFAULT 0,
		file_saves INTEGER NOT NULL DEFAULT 0,
		idle_sec   INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (day, bucket_idx)
	);

	CREATE TABLE IF NOT EXISTS patterns (
		id          TEXT PRIMARY KEY,
		day         TEXT NOT NULL,
		kind        TEXT NOT NULL,
		severity    TEXT NOT NULL,
		title       TEXT NOT NULL,
		detail      TEXT NOT NULL DEFAULT '',
		window      TEXT NOT NULL DEFAULT '',
		evidence    TEXT NOT NULL DEFAULT '{}',
		detected_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_patterns_day ON patterns(day);

	CREATE TABLE IF NOT EXISTS tasks (
		id   TEXT PRIMARY KEY,
		day  TEXT NOT NULL,
		kind TEXT NOT NULL,
		idx  INTEGER NOT NULL DEFAULT 0,
		text TEXT NOT NULL,
		done INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day);

	CREATE TABLE IF NOT EXISTS captures (
		id         TEXT PRIMARY KEY,
		text       TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS plans (
		day          TEXT PRIMARY KEY,
		status       TEXT NOT NULL DEFAULT 'draft',
		headline     TEXT NOT NULL DEFAULT '',
		constraints  TEXT NOT NULL DEFAULT '[]',
		bandwidth    TEXT NOT NULL DEFAULT '{}',
		tasks        TEXT NOT NULL DEFAULT '[]',
		generated_at INTEGER,
		locked_at    INTEGER
	);

	CREATE TABLE IF NOT EXISTS focus_sessions (
		id         TEXT PRIMARY KEY,
		task_id    TEXT NOT NULL,
		task_text  TEXT NOT NULL DEFAULT '',
		started_at INTEGER NOT NULL,
		ended_at   INTEGER,
		duration_sec INTEGER NOT NULL DEFAULT 0,
		outcome    TEXT NOT NULL DEFAULT 'active'
	);
	CREATE INDEX IF NOT EXISTS idx_focus_day ON focus_sessions(started_at);

	CREATE TABLE IF NOT EXISTS self_reports (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		day        TEXT NOT NULL,
		level      INTEGER NOT NULL,
		label      TEXT NOT NULL,
		ts         INTEGER NOT NULL,
		bucket_idx INTEGER NOT NULL,
		note       TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS idx_self_reports_day ON self_reports(day);

	CREATE TABLE IF NOT EXISTS projects (
		id    TEXT PRIMARY KEY,
		name  TEXT NOT NULL,
		path  TEXT NOT NULL UNIQUE,
		kind  TEXT NOT NULL DEFAULT 'work',
		color TEXT NOT NULL DEFAULT '#6b8cce'
	);

	CREATE TABLE IF NOT EXISTS budgets (
		day         TEXT PRIMARY KEY,
		allocations TEXT NOT NULL DEFAULT '[]'
	);

	CREATE TABLE IF NOT EXISTS daily_summaries (
		day               TEXT PRIMARY KEY,
		deep_work_min     INTEGER NOT NULL DEFAULT 0,
		leaked_min        INTEGER NOT NULL DEFAULT 0,
		sessions_count    INTEGER NOT NULL DEFAULT 0,
		avg_session_score REAL NOT NULL DEFAULT 0,
		momentum_peak     REAL NOT NULL DEFAULT 0,
		wall_time         TEXT NOT NULL DEFAULT '',
		budget_adherence  REAL NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS task_estimates (
		id            TEXT PRIMARY KEY,
		task_id       TEXT NOT NULL DEFAULT '',
		task_text     TEXT NOT NULL,
		estimated_min INTEGER NOT NULL DEFAULT 0,
		complexity    TEXT NOT NULL DEFAULT 'medium',
		cognitive_load INTEGER NOT NULL DEFAULT 0,
		confidence    INTEGER NOT NULL DEFAULT 0,
		should_split  INTEGER NOT NULL DEFAULT 0,
		splits_json   TEXT NOT NULL DEFAULT '[]',
		reasoning     TEXT NOT NULL DEFAULT '',
		matrix_json   TEXT NOT NULL DEFAULT '{}',
		source        TEXT NOT NULL DEFAULT 'heuristic',
		created_at    INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_estimates_task ON task_estimates(task_id);

	CREATE TABLE IF NOT EXISTS block_config (
		id          INTEGER PRIMARY KEY CHECK (id = 1),
		config_json TEXT NOT NULL DEFAULT '{}'
	);

	CREATE TABLE IF NOT EXISTS day_blocks (
		id           TEXT PRIMARY KEY,
		day          TEXT NOT NULL,
		idx          INTEGER NOT NULL DEFAULT 0,
		category     TEXT NOT NULL DEFAULT 'work',
		label        TEXT NOT NULL DEFAULT '',
		start_minute INTEGER NOT NULL DEFAULT 0,
		end_minute   INTEGER NOT NULL DEFAULT 0,
		status       TEXT NOT NULL DEFAULT 'planned',
		actual_start INTEGER NOT NULL DEFAULT 0,
		actual_end   INTEGER NOT NULL DEFAULT 0,
		notes        TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS idx_day_blocks_day ON day_blocks(day);
	`
	_, err := d.db.Exec(schema)
	return err
}

// ---------- Events ----------

func (d *DB) InsertEvents(ctx context.Context, events []models.RawEvent) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO raw_events (ts, source, kind, metadata, day) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, e := range events {
		meta, _ := json.Marshal(e.Metadata)
		day := e.Timestamp.Format("2006-01-02")
		if _, err := stmt.ExecContext(ctx, e.Timestamp.UnixMilli(), e.Source, e.Kind, string(meta), day); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// QueryEventsInWindow returns event kind → count for a time window.
func (d *DB) QueryEventsInWindow(ctx context.Context, day string, startMs, endMs int64) (map[string]int, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT kind, COUNT(*) FROM raw_events WHERE day = ? AND ts >= ? AND ts < ? GROUP BY kind`,
		day, startMs, endMs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]int)
	for rows.Next() {
		var kind string
		var count int
		if err := rows.Scan(&kind, &count); err != nil {
			return nil, err
		}
		result[kind] = count
	}
	return result, nil
}

// ---------- Sessions ----------

func (d *DB) UpsertSession(ctx context.Context, s models.Session) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO sessions (id, label, started_at, ended_at, message_count, error_count, status, day)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
			label=excluded.label, ended_at=excluded.ended_at,
			message_count=excluded.message_count, error_count=excluded.error_count,
			status=excluded.status`,
		s.ID, s.Label, s.StartedAt.Unix(), nilTime(s.EndedAt),
		s.MessageCount, s.ErrorCount, s.Status, s.Day)
	return err
}

func (d *DB) SessionsByDay(ctx context.Context, day string) ([]models.Session, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, label, started_at, ended_at, message_count, error_count, status, day
		 FROM sessions WHERE day = ? ORDER BY started_at`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Session
	for rows.Next() {
		var s models.Session
		var startedAt int64
		var endedAt sql.NullInt64
		if err := rows.Scan(&s.ID, &s.Label, &startedAt, &endedAt, &s.MessageCount, &s.ErrorCount, &s.Status, &s.Day); err != nil {
			return nil, err
		}
		s.StartedAt = time.Unix(startedAt, 0)
		if endedAt.Valid {
			t := time.Unix(endedAt.Int64, 0)
			s.EndedAt = &t
		}
		out = append(out, s)
	}
	return out, nil
}

func (d *DB) OpenSessions(ctx context.Context, day string) ([]models.Session, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, label, started_at, ended_at, message_count, error_count, status, day
		 FROM sessions WHERE day = ? AND status IN ('open','stalled') ORDER BY started_at DESC`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Session
	for rows.Next() {
		var s models.Session
		var startedAt int64
		var endedAt sql.NullInt64
		if err := rows.Scan(&s.ID, &s.Label, &startedAt, &endedAt, &s.MessageCount, &s.ErrorCount, &s.Status, &s.Day); err != nil {
			return nil, err
		}
		s.StartedAt = time.Unix(startedAt, 0)
		if endedAt.Valid {
			t := time.Unix(endedAt.Int64, 0)
			s.EndedAt = &t
		}
		out = append(out, s)
	}
	return out, nil
}

func (d *DB) CloseSession(ctx context.Context, id string) error {
	now := time.Now().Unix()
	_, err := d.db.ExecContext(ctx,
		`UPDATE sessions SET status = 'closed', ended_at = ? WHERE id = ?`, now, id)
	return err
}

// CloseOldSessions closes all sessions not from the given day.
func (d *DB) CloseOldSessions(ctx context.Context, today string) (int64, error) {
	result, err := d.db.ExecContext(ctx,
		`UPDATE sessions SET status = 'closed', ended_at = ? WHERE day != ? AND status IN ('open', 'stalled')`,
		time.Now().Unix(), today)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ---------- Buckets ----------

func (d *DB) BucketsByDay(ctx context.Context, day string) ([]models.Bucket, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT day, bucket_idx, hour, activity, errors, sessions, file_saves, idle_sec
		 FROM buckets WHERE day = ? ORDER BY bucket_idx`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Bucket
	for rows.Next() {
		var b models.Bucket
		if err := rows.Scan(&b.Day, &b.BucketIdx, &b.Hour, &b.Activity, &b.Errors, &b.Sessions, &b.FileSaves, &b.IdleSec); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

func (d *DB) UpsertBucket(ctx context.Context, b models.Bucket) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO buckets (day, bucket_idx, hour, activity, errors, sessions, file_saves, idle_sec)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(day, bucket_idx) DO UPDATE SET
			activity=excluded.activity, errors=excluded.errors, sessions=excluded.sessions,
			file_saves=excluded.file_saves, idle_sec=excluded.idle_sec`,
		b.Day, b.BucketIdx, b.Hour, b.Activity, b.Errors, b.Sessions, b.FileSaves, b.IdleSec)
	return err
}

// ---------- Tasks ----------

func (d *DB) TasksByDay(ctx context.Context, day string) ([]models.Task, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, day, kind, idx, text, done FROM tasks WHERE day = ? ORDER BY kind, idx`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Task
	for rows.Next() {
		var t models.Task
		var done int
		if err := rows.Scan(&t.ID, &t.Day, &t.Kind, &t.Idx, &t.Text, &done); err != nil {
			return nil, err
		}
		t.Done = done == 1
		out = append(out, t)
	}
	return out, nil
}

func (d *DB) UpsertTask(ctx context.Context, t models.Task) error {
	doneInt := 0
	if t.Done {
		doneInt = 1
	}
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO tasks (id, day, kind, idx, text, done) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET done=excluded.done, text=excluded.text`,
		t.ID, t.Day, t.Kind, t.Idx, t.Text, doneInt)
	return err
}

func (d *DB) ToggleTask(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE tasks SET done = CASE WHEN done = 0 THEN 1 ELSE 0 END WHERE id = ?`, id)
	return err
}

// ---------- Captures ----------

func (d *DB) InsertCapture(ctx context.Context, c models.Capture) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO captures (id, text, created_at) VALUES (?, ?, ?)`,
		c.ID, c.Text, c.CreatedAt.UnixMilli())
	return err
}

func (d *DB) RecentCaptures(ctx context.Context, limit int) ([]models.Capture, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, text, created_at FROM captures ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Capture
	for rows.Next() {
		var c models.Capture
		var createdAt int64
		if err := rows.Scan(&c.ID, &c.Text, &createdAt); err != nil {
			return nil, err
		}
		c.CreatedAt = time.UnixMilli(createdAt)
		out = append(out, c)
	}
	return out, nil
}

// ---------- Patterns ----------

func (d *DB) PatternsByDay(ctx context.Context, day string) ([]models.Pattern, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, day, kind, severity, title, detail, window, evidence, detected_at
		 FROM patterns WHERE day = ? ORDER BY detected_at DESC`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Pattern
	for rows.Next() {
		var p models.Pattern
		var evidenceStr string
		var detectedAt int64
		if err := rows.Scan(&p.ID, &p.Day, &p.Kind, &p.Severity, &p.Title, &p.Detail, &p.Window, &evidenceStr, &detectedAt); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(evidenceStr), &p.Evidence)
		p.DetectedAt = time.Unix(detectedAt, 0)
		out = append(out, p)
	}
	return out, nil
}

func (d *DB) InsertPattern(ctx context.Context, p models.Pattern) error {
	evidence, _ := json.Marshal(p.Evidence)
	_, err := d.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO patterns (id, day, kind, severity, title, detail, window, evidence, detected_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Day, p.Kind, p.Severity, p.Title, p.Detail, p.Window, string(evidence), p.DetectedAt.Unix())
	return err
}

// ---------- Plans ----------

func (d *DB) PlanByDay(ctx context.Context, day string) (*models.Plan, error) {
	row := d.db.QueryRowContext(ctx,
		`SELECT day, status, headline, constraints, bandwidth, tasks, generated_at, locked_at
		 FROM plans WHERE day = ?`, day)

	var p models.Plan
	var constraintsStr, bandwidthStr, tasksStr string
	var generatedAt, lockedAt sql.NullInt64
	err := row.Scan(&p.Day, &p.Status, &p.Headline, &constraintsStr, &bandwidthStr, &tasksStr, &generatedAt, &lockedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(constraintsStr), &p.Constraints)
	json.Unmarshal([]byte(bandwidthStr), &p.Bandwidth)
	json.Unmarshal([]byte(tasksStr), &p.Tasks)
	if generatedAt.Valid {
		t := time.Unix(generatedAt.Int64, 0)
		p.GeneratedAt = &t
	}
	if lockedAt.Valid {
		t := time.Unix(lockedAt.Int64, 0)
		p.LockedAt = &t
	}
	return &p, nil
}

func (d *DB) UpsertPlan(ctx context.Context, p models.Plan) error {
	constraints, _ := json.Marshal(p.Constraints)
	bandwidth, _ := json.Marshal(p.Bandwidth)
	tasks, _ := json.Marshal(p.Tasks)
	var genAt, lockAt *int64
	if p.GeneratedAt != nil {
		v := p.GeneratedAt.Unix()
		genAt = &v
	}
	if p.LockedAt != nil {
		v := p.LockedAt.Unix()
		lockAt = &v
	}
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO plans (day, status, headline, constraints, bandwidth, tasks, generated_at, locked_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(day) DO UPDATE SET
			status=excluded.status, headline=excluded.headline,
			constraints=excluded.constraints, bandwidth=excluded.bandwidth,
			tasks=excluded.tasks, generated_at=excluded.generated_at, locked_at=excluded.locked_at`,
		p.Day, p.Status, p.Headline, string(constraints), string(bandwidth), string(tasks), genAt, lockAt)
	return err
}

// ---------- Tasks (extended CRUD) ----------

func (d *DB) CreateTask(ctx context.Context, t models.Task) error {
	doneInt := 0
	if t.Done {
		doneInt = 1
	}
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO tasks (id, day, kind, idx, text, done) VALUES (?, ?, ?, ?, ?, ?)`,
		t.ID, t.Day, t.Kind, t.Idx, t.Text, doneInt)
	return err
}

func (d *DB) UpdateTask(ctx context.Context, id string, text string, kind string, idx int) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE tasks SET text = ?, kind = ?, idx = ? WHERE id = ?`,
		text, kind, idx, id)
	return err
}

func (d *DB) DeleteTask(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM tasks WHERE id = ?`, id)
	return err
}

func (d *DB) ReorderTasks(ctx context.Context, orders []models.TaskOrder) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, `UPDATE tasks SET idx = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, o := range orders {
		if _, err := stmt.ExecContext(ctx, o.Idx, o.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) NextTaskIdx(ctx context.Context, day string, kind string) (int, error) {
	var maxIdx sql.NullInt64
	err := d.db.QueryRowContext(ctx,
		`SELECT MAX(idx) FROM tasks WHERE day = ? AND kind = ?`, day, kind).Scan(&maxIdx)
	if err != nil {
		return 1, err
	}
	if maxIdx.Valid {
		return int(maxIdx.Int64) + 1, nil
	}
	return 1, nil
}

// ---------- Captures (extended) ----------

func (d *DB) DeleteCapture(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM captures WHERE id = ?`, id)
	return err
}

func (d *DB) GetCapture(ctx context.Context, id string) (*models.Capture, error) {
	var c models.Capture
	var createdAt int64
	err := d.db.QueryRowContext(ctx,
		`SELECT id, text, created_at FROM captures WHERE id = ?`, id).Scan(&c.ID, &c.Text, &createdAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.CreatedAt = time.UnixMilli(createdAt)
	return &c, nil
}

// ---------- Focus Sessions ----------

func (d *DB) StartFocusSession(ctx context.Context, fs models.FocusSession) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO focus_sessions (id, task_id, task_text, started_at, outcome) VALUES (?, ?, ?, ?, 'active')`,
		fs.ID, fs.TaskID, fs.TaskText, fs.StartedAt.Unix())
	return err
}

func (d *DB) StopFocusSession(ctx context.Context, id string, outcome string) error {
	now := time.Now().Unix()
	_, err := d.db.ExecContext(ctx,
		`UPDATE focus_sessions SET ended_at = ?, duration_sec = (? - started_at), outcome = ? WHERE id = ?`,
		now, now, outcome, id)
	return err
}

func (d *DB) ActiveFocusSession(ctx context.Context) (*models.FocusSession, error) {
	var fs models.FocusSession
	var startedAt int64
	var endedAt sql.NullInt64
	err := d.db.QueryRowContext(ctx,
		`SELECT id, task_id, task_text, started_at, ended_at, duration_sec, outcome
		 FROM focus_sessions WHERE outcome = 'active' ORDER BY started_at DESC LIMIT 1`).
		Scan(&fs.ID, &fs.TaskID, &fs.TaskText, &startedAt, &endedAt, &fs.DurationSec, &fs.Outcome)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	fs.StartedAt = time.Unix(startedAt, 0)
	if endedAt.Valid {
		t := time.Unix(endedAt.Int64, 0)
		fs.EndedAt = &t
	}
	return &fs, nil
}

func (d *DB) FocusSessionsByDay(ctx context.Context, day string) ([]models.FocusSession, error) {
	startOfDay, _ := time.Parse("2006-01-02", day)
	endOfDay := startOfDay.AddDate(0, 0, 1)

	rows, err := d.db.QueryContext(ctx,
		`SELECT id, task_id, task_text, started_at, ended_at, duration_sec, outcome
		 FROM focus_sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at`,
		startOfDay.Unix(), endOfDay.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.FocusSession
	for rows.Next() {
		var fs models.FocusSession
		var startedAt int64
		var endedAt sql.NullInt64
		if err := rows.Scan(&fs.ID, &fs.TaskID, &fs.TaskText, &startedAt, &endedAt, &fs.DurationSec, &fs.Outcome); err != nil {
			return nil, err
		}
		fs.StartedAt = time.Unix(startedAt, 0)
		if endedAt.Valid {
			t := time.Unix(endedAt.Int64, 0)
			fs.EndedAt = &t
		}
		out = append(out, fs)
	}
	return out, nil
}

// ---------- Sessions (extended) ----------

func (d *DB) CreateSession(ctx context.Context, s models.Session) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO sessions (id, label, started_at, message_count, error_count, status, day)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		s.ID, s.Label, s.StartedAt.Unix(), s.MessageCount, s.ErrorCount, s.Status, s.Day)
	return err
}

func (d *DB) UpdateSession(ctx context.Context, id string, label string, status string) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE sessions SET label = ?, status = ? WHERE id = ?`,
		label, status, id)
	return err
}

func (d *DB) IncrementSessionMessages(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE sessions SET message_count = message_count + 1 WHERE id = ?`, id)
	return err
}

// ---------- Plans (extended) ----------

func (d *DB) UpdatePlan(ctx context.Context, p models.Plan) error {
	constraints, _ := json.Marshal(p.Constraints)
	bandwidth, _ := json.Marshal(p.Bandwidth)
	tasks, _ := json.Marshal(p.Tasks)
	_, err := d.db.ExecContext(ctx,
		`UPDATE plans SET headline = ?, constraints = ?, bandwidth = ?, tasks = ? WHERE day = ?`,
		p.Headline, string(constraints), string(bandwidth), string(tasks), p.Day)
	return err
}

// ---------- Queries for Signal Computation ----------

// RecentEventCount returns the number of events of a given kind in the last N minutes.
func (d *DB) RecentEventCount(ctx context.Context, day string, kind string, sinceMs int64) (int, error) {
	var count int
	err := d.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM raw_events WHERE day = ? AND kind = ? AND ts >= ?`,
		day, kind, sinceMs).Scan(&count)
	return count, err
}

// RecentEventCountBySource returns the number of events from a source in the last N minutes.
func (d *DB) RecentEventCountBySource(ctx context.Context, day string, source string, sinceMs int64) (int, error) {
	var count int
	err := d.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM raw_events WHERE day = ? AND source = ? AND ts >= ?`,
		day, source, sinceMs).Scan(&count)
	return count, err
}

// LastEventTimestamp returns the most recent event timestamp (unix ms) for a day, or 0 if none.
func (d *DB) LastEventTimestamp(ctx context.Context, day string) (int64, error) {
	var ts sql.NullInt64
	err := d.db.QueryRowContext(ctx,
		`SELECT MAX(ts) FROM raw_events WHERE day = ?`, day).Scan(&ts)
	if err != nil || !ts.Valid {
		return 0, err
	}
	return ts.Int64, nil
}

// RecentBuckets returns the last N buckets for a day, ordered by bucket_idx descending.
func (d *DB) RecentBuckets(ctx context.Context, day string, limit int) ([]models.Bucket, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT day, bucket_idx, hour, activity, errors, sessions, file_saves, idle_sec
		 FROM buckets WHERE day = ? ORDER BY bucket_idx DESC LIMIT ?`, day, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Bucket
	for rows.Next() {
		var b models.Bucket
		if err := rows.Scan(&b.Day, &b.BucketIdx, &b.Hour, &b.Activity, &b.Errors, &b.Sessions, &b.FileSaves, &b.IdleSec); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

// BucketsInRange returns buckets between two hours for a day.
func (d *DB) BucketsInRange(ctx context.Context, day string, fromHour, toHour float64) ([]models.Bucket, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT day, bucket_idx, hour, activity, errors, sessions, file_saves, idle_sec
		 FROM buckets WHERE day = ? AND hour >= ? AND hour < ? ORDER BY bucket_idx`, day, fromHour, toHour)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Bucket
	for rows.Next() {
		var b models.Bucket
		if err := rows.Scan(&b.Day, &b.BucketIdx, &b.Hour, &b.Activity, &b.Errors, &b.Sessions, &b.FileSaves, &b.IdleSec); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

// SessionCountSince returns how many new sessions started since a timestamp.
func (d *DB) SessionCountSince(ctx context.Context, day string, sinceUnix int64) (int, error) {
	var count int
	err := d.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sessions WHERE day = ? AND started_at >= ?`,
		day, sinceUnix).Scan(&count)
	return count, err
}

// SingleMessageSessions returns sessions with exactly 1 message that are still open.
func (d *DB) SingleMessageSessions(ctx context.Context, day string) (int, error) {
	var count int
	err := d.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sessions WHERE day = ? AND message_count <= 1 AND status = 'open'`,
		day).Scan(&count)
	return count, err
}

// ActiveFocusMinutes returns how many minutes the current focus session has been running.
func (d *DB) ActiveFocusMinutes(ctx context.Context) (int, error) {
	var startedAt sql.NullInt64
	err := d.db.QueryRowContext(ctx,
		`SELECT started_at FROM focus_sessions WHERE outcome = 'active' ORDER BY started_at DESC LIMIT 1`).Scan(&startedAt)
	if err != nil || !startedAt.Valid {
		return 0, nil
	}
	elapsed := time.Since(time.Unix(startedAt.Int64, 0))
	return int(elapsed.Minutes()), nil
}

// ---------- Self Reports ----------

// EventsByDay returns all raw events for a day, ordered by timestamp.
func (d *DB) EventsByDay(ctx context.Context, day string) ([]models.RawEvent, error) {
	rows, err := d.db.QueryContext(ctx,
		"SELECT id, ts, source, kind, metadata, day FROM raw_events WHERE day=? ORDER BY ts", day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.RawEvent
	for rows.Next() {
		var e models.RawEvent
		var meta string
		var tsMs int64
		if err := rows.Scan(&e.ID, &tsMs, &e.Source, &e.Kind, &meta, &e.Day); err != nil {
			return nil, err
		}
		e.Timestamp = time.UnixMilli(tsMs)
		json.Unmarshal([]byte(meta), &e.Metadata)
		out = append(out, e)
	}
	return out, nil
}

func (d *DB) InsertSelfReport(ctx context.Context, day string, level int, label string, ts int64, bucketIdx int, note string) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO self_reports (day, level, label, ts, bucket_idx, note) VALUES (?, ?, ?, ?, ?, ?)`,
		day, level, label, ts, bucketIdx, note)
	return err
}

func (d *DB) SelfReportsByDay(ctx context.Context, day string) ([]models.SelfReport, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, day, level, label, ts, bucket_idx, note FROM self_reports WHERE day = ? ORDER BY ts`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.SelfReport
	for rows.Next() {
		var r models.SelfReport
		if err := rows.Scan(&r.ID, &r.Day, &r.Level, &r.Label, &r.Ts, &r.BucketIdx, &r.Note); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// ---------- Projects ----------

func (d *DB) ListProjects(ctx context.Context) ([]models.Project, error) {
	rows, err := d.db.QueryContext(ctx, "SELECT id, name, path, kind, color FROM projects ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Project
	for rows.Next() {
		var p models.Project
		rows.Scan(&p.ID, &p.Name, &p.Path, &p.Kind, &p.Color)
		out = append(out, p)
	}
	return out, nil
}

func (d *DB) UpsertProject(ctx context.Context, p models.Project) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO projects (id, name, path, kind, color) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET name=excluded.name, kind=excluded.kind, color=excluded.color`,
		p.ID, p.Name, p.Path, p.Kind, p.Color)
	return err
}

func (d *DB) DeleteProject(ctx context.Context, id string) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM projects WHERE id=?", id)
	return err
}

func (d *DB) ProjectByPath(ctx context.Context, path string) (models.Project, error) {
	var p models.Project
	err := d.db.QueryRowContext(ctx, "SELECT id, name, path, kind, color FROM projects WHERE path=?", path).
		Scan(&p.ID, &p.Name, &p.Path, &p.Kind, &p.Color)
	return p, err
}

// ---------- Budgets ----------

func (d *DB) GetBudget(ctx context.Context, day string) (models.DailyBudget, error) {
	var b models.DailyBudget
	b.Day = day
	var raw string
	err := d.db.QueryRowContext(ctx, "SELECT allocations FROM budgets WHERE day=?", day).Scan(&raw)
	if err != nil {
		return b, err
	}
	json.Unmarshal([]byte(raw), &b.Allocations)
	return b, nil
}

func (d *DB) UpsertBudget(ctx context.Context, b models.DailyBudget) error {
	data, _ := json.Marshal(b.Allocations)
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO budgets (day, allocations) VALUES (?, ?)
		 ON CONFLICT(day) DO UPDATE SET allocations=excluded.allocations`,
		b.Day, string(data))
	return err
}

// ---------- Daily Summaries (Trends) ----------

func (d *DB) UpsertDailySummary(ctx context.Context, s models.DailySummaryRecord) error {
	_, err := d.db.ExecContext(ctx,
		`INSERT INTO daily_summaries (day, deep_work_min, leaked_min, sessions_count, avg_session_score, momentum_peak, wall_time, budget_adherence)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(day) DO UPDATE SET
		   deep_work_min=excluded.deep_work_min, leaked_min=excluded.leaked_min,
		   sessions_count=excluded.sessions_count, avg_session_score=excluded.avg_session_score,
		   momentum_peak=excluded.momentum_peak, wall_time=excluded.wall_time,
		   budget_adherence=excluded.budget_adherence`,
		s.Day, s.DeepWorkMin, s.LeakedMin, s.SessionsCount, s.AvgSessionScore,
		s.MomentumPeak, s.WallTime, s.BudgetAdherence)
	return err
}

func (d *DB) GetTrends(ctx context.Context, days int) ([]models.DailySummaryRecord, error) {
	rows, err := d.db.QueryContext(ctx,
		"SELECT day, deep_work_min, leaked_min, sessions_count, avg_session_score, momentum_peak, wall_time, budget_adherence FROM daily_summaries ORDER BY day DESC LIMIT ?", days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.DailySummaryRecord
	for rows.Next() {
		var s models.DailySummaryRecord
		rows.Scan(&s.Day, &s.DeepWorkMin, &s.LeakedMin, &s.SessionsCount, &s.AvgSessionScore, &s.MomentumPeak, &s.WallTime, &s.BudgetAdherence)
		out = append(out, s)
	}
	return out, nil
}

// SessionCountsByDay returns the number of sessions per day for the last N days.
func (d *DB) SessionCountsByDay(ctx context.Context, days int) (map[string]int, error) {
	cutoff := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	rows, err := d.db.QueryContext(ctx,
		"SELECT day, COUNT(*) FROM sessions WHERE day >= ? GROUP BY day ORDER BY day", cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[string]int)
	for rows.Next() {
		var day string
		var count int
		rows.Scan(&day, &count)
		m[day] = count
	}
	return m, nil
}

// ---------- Helpers ----------

func nilTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Unix()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// InsertTaskEstimate persists a cognitive budget estimate.
func (d *DB) InsertTaskEstimate(ctx context.Context, est models.TaskEstimate) error {
	splitsJSON, _ := json.Marshal(est.SuggestedSplits)
	matrixJSON, _ := json.Marshal(est.Matrix)
	_, err := d.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO task_estimates (id, task_id, task_text, estimated_min, complexity, cognitive_load, confidence, should_split, splits_json, reasoning, matrix_json, source, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		est.ID, est.TaskID, est.TaskText, est.EstimatedMin, est.Complexity, est.CognitiveLoad, est.Confidence,
		boolToInt(est.ShouldSplit), string(splitsJSON), est.Reasoning, string(matrixJSON), est.Source, est.CreatedAt.UnixMilli(),
	)
	return err
}

// TaskEstimatesByDay returns all estimates created today.
func (d *DB) TaskEstimatesByDay(ctx context.Context, day string) ([]models.TaskEstimate, error) {
	// Parse day to get start/end timestamps
	t, err := time.Parse("2006-01-02", day)
	if err != nil {
		return nil, err
	}
	startMs := t.UnixMilli()
	endMs := t.Add(24 * time.Hour).UnixMilli()

	rows, err := d.db.QueryContext(ctx,
		`SELECT id, task_id, task_text, estimated_min, complexity, cognitive_load, confidence, should_split, splits_json, reasoning, matrix_json, source, created_at
		 FROM task_estimates WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC`, startMs, endMs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var estimates []models.TaskEstimate
	for rows.Next() {
		var est models.TaskEstimate
		var shouldSplit int
		var splitsJSON, matrixJSON string
		var createdAtMs int64
		err := rows.Scan(&est.ID, &est.TaskID, &est.TaskText, &est.EstimatedMin, &est.Complexity,
			&est.CognitiveLoad, &est.Confidence, &shouldSplit, &splitsJSON, &est.Reasoning,
			&matrixJSON, &est.Source, &createdAtMs)
		if err != nil {
			continue
		}
		est.ShouldSplit = shouldSplit != 0
		est.CreatedAt = time.UnixMilli(createdAtMs)
		_ = json.Unmarshal([]byte(splitsJSON), &est.SuggestedSplits)
		_ = json.Unmarshal([]byte(matrixJSON), &est.Matrix)
		estimates = append(estimates, est)
	}
	return estimates, nil
}

// LatestEstimateForTask returns the most recent estimate for a given task.
func (d *DB) LatestEstimateForTask(ctx context.Context, taskID string) (*models.TaskEstimate, error) {
	row := d.db.QueryRowContext(ctx,
		`SELECT id, task_id, task_text, estimated_min, complexity, cognitive_load, confidence, should_split, splits_json, reasoning, matrix_json, source, created_at
		 FROM task_estimates WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`, taskID)

	var est models.TaskEstimate
	var shouldSplit int
	var splitsJSON, matrixJSON string
	var createdAtMs int64
	err := row.Scan(&est.ID, &est.TaskID, &est.TaskText, &est.EstimatedMin, &est.Complexity,
		&est.CognitiveLoad, &est.Confidence, &shouldSplit, &splitsJSON, &est.Reasoning,
		&matrixJSON, &est.Source, &createdAtMs)
	if err != nil {
		return nil, err
	}
	est.ShouldSplit = shouldSplit != 0
	est.CreatedAt = time.UnixMilli(createdAtMs)
	_ = json.Unmarshal([]byte(splitsJSON), &est.SuggestedSplits)
	_ = json.Unmarshal([]byte(matrixJSON), &est.Matrix)
	return &est, nil
}

// ── Block Config ────────────────────────────────────────────────────────────

func (d *DB) GetBlockConfig(ctx context.Context) (models.BlockConfig, error) {
	var raw string
	err := d.db.QueryRowContext(ctx, `SELECT config_json FROM block_config WHERE id = 1`).Scan(&raw)
	if err != nil {
		// Return defaults if no config exists
		return models.BlockConfig{
			BlockDurationMin: 90,
			WorkDayStartHour: 9.0,
			WorkDayEndHour:   17.0,
			Allocations: []models.BlockAllocation{
				{Category: "work", Pct: 60, Label: "Main Work", Color: "#6b8cce"},
				{Category: "side_project", Pct: 40, Label: "Side Project", Color: "#ce6b8c"},
			},
			NonNegotiables: []models.NonNegotiable{
				{ID: "lunch", Label: "Lunch", StartHour: 12.0, EndHour: 13.0, Days: []int{}},
			},
		}, nil
	}
	var cfg models.BlockConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return models.BlockConfig{}, err
	}
	return cfg, nil
}

func (d *DB) UpsertBlockConfig(ctx context.Context, cfg models.BlockConfig) error {
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = d.db.ExecContext(ctx,
		`INSERT INTO block_config (id, config_json) VALUES (1, ?)
		 ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json`, string(b))
	return err
}

// ── Day Blocks ──────────────────────────────────────────────────────────────

func (d *DB) DayBlocks(ctx context.Context, day string) ([]models.DayBlock, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, day, idx, category, label, start_minute, end_minute, status, actual_start, actual_end, notes
		 FROM day_blocks WHERE day = ? ORDER BY idx`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []models.DayBlock
	for rows.Next() {
		var b models.DayBlock
		if err := rows.Scan(&b.ID, &b.Day, &b.Idx, &b.Category, &b.Label,
			&b.StartMinute, &b.EndMinute, &b.Status, &b.ActualStart, &b.ActualEnd, &b.Notes); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, rows.Err()
}

func (d *DB) InsertDayBlocks(ctx context.Context, blocks []models.DayBlock) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, b := range blocks {
		_, err := tx.ExecContext(ctx,
			`INSERT OR REPLACE INTO day_blocks (id, day, idx, category, label, start_minute, end_minute, status, actual_start, actual_end, notes)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			b.ID, b.Day, b.Idx, b.Category, b.Label, b.StartMinute, b.EndMinute, b.Status, b.ActualStart, b.ActualEnd, b.Notes)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) UpdateDayBlock(ctx context.Context, b models.DayBlock) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE day_blocks SET category=?, label=?, start_minute=?, end_minute=?, status=?, actual_start=?, actual_end=?, notes=?
		 WHERE id=?`,
		b.Category, b.Label, b.StartMinute, b.EndMinute, b.Status, b.ActualStart, b.ActualEnd, b.Notes, b.ID)
	return err
}

func (d *DB) DeleteDayBlocks(ctx context.Context, day string) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM day_blocks WHERE day = ?`, day)
	return err
}
