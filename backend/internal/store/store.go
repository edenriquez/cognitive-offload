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

// ---------- Helpers ----------

func nilTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Unix()
}
