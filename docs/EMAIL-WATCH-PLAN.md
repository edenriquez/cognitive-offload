# Email Watch Integration — Plan

> Status: Planned  
> Last updated: 2026-05-25

---

## The Problem Being Solved

You have a task on the map: "Follow up on email from X." The email hasn't arrived yet. You don't want to keep a mail tab open. You want the system to watch your inbox in the background and surface the email the moment it lands — directly in the map sidebar for that task, without breaking your focus.

This is a **task-bound inbox watch**: one email rule, attached to one task node, running on a cron until the email arrives or the task is done.

---

## Core Concept: Email Watch Rules

An email watch rule is a small filter attached to a task. It describes what to look for:

```
Task: "Follow up on invoice from Acme"
Watch:
  - from: acme.com
  - subject_contains: "invoice"
  - check_every: 5 minutes
  - stop_when: email_found | task_done
```

When the backend finds a match, it:
1. Stores the matched email metadata (not the body — just sender, subject, timestamp)
2. Pushes a WebSocket notification to the frontend
3. The task node on the map gets a visual indicator
4. The sidebar for that task shows the match with a link to open the email

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Cogload Backend                        │
│                                                           │
│  ┌─────────────────┐    ┌────────────────────────────┐   │
│  │  EmailWatcher   │───▶│  Store (email_watches,     │   │
│  │  (IMAP poller)  │    │   email_matches tables)    │   │
│  │  goroutine per  │    └────────────────────────────┘   │
│  │  active watch   │              │                       │
│  └─────────────────┘              │ match found           │
│           │                       ▼                       │
│           │              ┌─────────────────┐              │
│           └─────────────▶│   WebSocket Hub │              │
│                           │   broadcast     │              │
│                           └────────┬────────┘             │
└────────────────────────────────────┼─────────────────────┘
                                     │
                              ┌──────▼──────┐
                              │  Frontend   │
                              │  Map node   │
                              │  gets dot   │
                              │  Sidebar    │
                              │  shows hit  │
                              └─────────────┘
```

The `EmailWatcher` follows the exact same pattern as `FSWatcher` and `GitMonitor` — a long-running goroutine started via `Coordinator.Start()`, polling IMAP on a configurable interval.

---

## Data Model

### New tables

```sql
-- One watch rule per task
CREATE TABLE IF NOT EXISTS email_watches (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL,
    from_filter  TEXT NOT NULL DEFAULT '',   -- partial match on sender address
    subject_filter TEXT NOT NULL DEFAULT '', -- partial match (case-insensitive)
    check_every_sec INTEGER NOT NULL DEFAULT 300, -- default 5 min
    status       TEXT NOT NULL DEFAULT 'active', -- active | paused | matched | done
    created_at   INTEGER NOT NULL,
    matched_at   INTEGER,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- When a match arrives, one row per match
CREATE TABLE IF NOT EXISTS email_matches (
    id         TEXT PRIMARY KEY,
    watch_id   TEXT NOT NULL,
    task_id    TEXT NOT NULL,
    from_addr  TEXT NOT NULL,
    subject    TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (watch_id) REFERENCES email_watches(id) ON DELETE CASCADE
);
```

### New models

```go
type EmailWatch struct {
    ID             string  `json:"id"`
    TaskID         string  `json:"task_id"`
    FromFilter     string  `json:"from_filter"`
    SubjectFilter  string  `json:"subject_filter"`
    CheckEverySec  int     `json:"check_every_sec"`
    Status         string  `json:"status"` // active|paused|matched|done
    CreatedAt      int64   `json:"created_at"`
    MatchedAt      *int64  `json:"matched_at,omitempty"`
}

type EmailMatch struct {
    ID          string `json:"id"`
    WatchID     string `json:"watch_id"`
    TaskID      string `json:"task_id"`
    FromAddr    string `json:"from_addr"`
    Subject     string `json:"subject"`
    ReceivedAt  int64  `json:"received_at"`
    MessageID   string `json:"message_id"`
}
```

---

## IMAP Polling

Uses Go's standard `net/imap` approach via the `github.com/emersion/go-imap` library (MIT, widely used, well maintained).

```
go get github.com/emersion/go-imap/v2
go get github.com/emersion/go-imap/v2/imapclient
```

### EmailWatcher goroutine

```go
type EmailWatcher struct {
    db   *store.DB
    hub  *ws.Hub
    stop chan struct{}
}

func (w *EmailWatcher) Start(ctx context.Context) {
    go w.loop(ctx)
}

func (w *EmailWatcher) loop(ctx context.Context) {
    ticker := time.NewTicker(60 * time.Second) // master tick, each watch has its own interval
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-ticker.C:
            w.checkAll(ctx)
        }
    }
}

func (w *EmailWatcher) checkAll(ctx context.Context) {
    watches, _ := w.db.ActiveEmailWatches(ctx)
    for _, watch := range watches {
        // Only poll if interval has elapsed since last check
        if time.Now().Unix() - watch.LastChecked < int64(watch.CheckEverySec) {
            continue
        }
        go w.checkWatch(ctx, watch)
    }
}
```

### IMAP check for a single watch

```go
func (w *EmailWatcher) checkWatch(ctx context.Context, watch EmailWatch) {
    creds, _ := w.db.GetEmailCredentials(ctx)
    if creds == nil { return }

    c, err := imapclient.DialTLS(creds.IMAPServer, nil)
    if err != nil { return }
    defer c.Logout()

    if err := c.Login(creds.Username, creds.Password).Wait(); err != nil { return }

    // Select INBOX
    mbox, err := c.Select("INBOX", nil).Wait()
    if err != nil { return }

    // Search UNSEEN matching the filter
    // IMAP SEARCH: UNSEEN FROM "filter" SUBJECT "filter"
    // Only emails received since watch was created (SINCE date)
    criteria := buildSearchCriteria(watch)
    msgs, err := c.Search(criteria, nil).Wait()
    if err != nil || len(msgs.AllSeqNums()) == 0 { return }

    // Match found — store it and push notification
    w.recordMatch(ctx, watch, msgs)
}
```

The IMAP search only fetches **envelope headers** (from, subject, date, message-id) — never the body. This is important: we never download email content, only metadata needed to confirm the match.

---

## Credentials Storage

Stored in `~/.cogload/config.json` alongside other settings, as a new `email` block:

```json
{
  "email": {
    "imap_server": "imap.gmail.com:993",
    "username": "you@gmail.com",
    "password": "app-specific-password",
    "tls": true
  }
}
```

**For Gmail**: requires an App Password (not your regular password). Standard Google IMAP must be enabled in Gmail settings.
**For Apple Mail / iCloud**: `imap.mail.me.com:993` with App Password.
**For any IMAP provider**: server, port, username, password.

Credentials are never stored in the database — only in the config file on disk, only readable by the current user.

### Settings UI addition

A new "Email" section in the Settings tab:
- IMAP server + port
- Username
- Password (masked, app password only)
- Test connection button → calls `POST /api/v1/email/test`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tasks/:id/watches` | List email watches for a task |
| `POST` | `/api/v1/tasks/:id/watches` | Create an email watch for a task |
| `DELETE` | `/api/v1/email/watches/:id` | Delete a watch |
| `PATCH` | `/api/v1/email/watches/:id/pause` | Pause/resume a watch |
| `GET` | `/api/v1/email/matches` | All matches for today |
| `POST` | `/api/v1/email/test` | Test IMAP credentials |

---

## WebSocket Notification

When a match is found, the backend broadcasts a new message type via the existing WebSocket hub:

```go
type EmailMatchEvent struct {
    Type    string     `json:"type"`    // "email_match"
    Match   EmailMatch `json:"match"`
    Watch   EmailWatch `json:"watch"`
}
```

The frontend receives this on the existing `ws-client.ts` connection. A new handler checks `event.type === "email_match"` and:
1. Stores the match in a local `emailMatches` Zustand slice
2. If the matched task is on the map, adds a visual indicator to that node
3. Shows a non-blocking toast: "Email arrived: [subject] · Open task"

---

## Frontend: Map Integration

### Task node visual

`TaskNodeData` gets a new field: `hasEmailMatch: boolean`. When `true`, the node renders a small envelope icon in the header row — same position as the pulse dot for focused tasks. The icon uses the existing status icon pattern.

```
┌──────────────────────────────┐
│  must                    ✉  │  ← envelope icon when match arrived
│  Follow up on invoice        │
└──────────────────────────────┘
```

The node state is `tnode--email-match` — blue envelope, no pulsing.

### Sidebar: Email Watch panel

In the `TaskControlPanel`, after the notes section, a new collapsible section: **"Email watch"**.

**No watch configured:**
```
┌─────────────────────────────────┐
│  Email watch                    │
│  Watch for an incoming email    │
│  [+ Add watch]                  │
└─────────────────────────────────┘
```

**Watch active:**
```
┌─────────────────────────────────┐
│  Email watch          ● active  │
│  from:    acme.com              │
│  subject: invoice               │
│  checks every 5 min             │
│  Last checked: 2 min ago        │
│  [Pause]  [Delete]              │
└─────────────────────────────────┘
```

**Match found:**
```
┌─────────────────────────────────┐
│  Email watch       ✓ matched    │
│  "RE: Invoice #4421"            │
│  from: billing@acme.com         │
│  arrived: 2:34 PM               │
└─────────────────────────────────┘
```

**Add watch form (inline, no modal):**
```
┌─────────────────────────────────┐
│  Add email watch                │
│  From (partial)  [acme.com    ] │
│  Subject         [invoice     ] │
│  Check every     [5 min    ▼ ] │
│  [Start watching]  [Cancel]     │
└─────────────────────────────────┘
```

---

## Implementation Phases

### Phase A — Backend core (2 days)

1. Add `email_watches` and `email_matches` tables to store.go
2. Add `EmailWatch`, `EmailMatch` models to models.go
3. Add `GetEmailCredentials` / `SaveEmailCredentials` to config and store
4. Add IMAP dependency: `go get github.com/emersion/go-imap/v2`
5. Create `ingest/emailwatcher.go` — polling loop, IMAP check, match recording
6. Add `EmailWatcher` to `Coordinator`
7. Add API endpoints (6 routes)
8. Push `EmailMatchEvent` via hub on match

**Exit criteria:** `curl POST /api/v1/tasks/:id/watches` creates a watch. Backend polls IMAP every 5 minutes. When a matching email arrives, `email_matches` table gets a row and a WS event is broadcast.

### Phase B — Frontend integration (2 days)

1. Add `EmailWatch`, `EmailMatch` types to `types/index.ts`
2. Add 4 API client methods
3. Add `emailMatches: EmailMatch[]` to Zustand store, populated from WS events
4. Update `TaskNodeData` with `hasEmailMatch: boolean`
5. Update `TaskNode.tsx` — envelope icon state
6. Build `EmailWatchPanel` component (inline, no modal)
7. Wire into `TaskControlPanel` after NoteEditor
8. Add WS event handler in `ws-client.ts` for `email_match` type

**Exit criteria:** Create a watch from the map sidebar. Node shows envelope icon when email arrives. Toast notification fires.

### Phase C — Settings UI (0.5 days)

1. Add "Email" section to `SettingsMode.tsx`
2. IMAP server, username, password (masked) inputs
3. "Test connection" button → `POST /api/v1/email/test` → success/failure inline

**Exit criteria:** Enter Gmail app password in Settings. Test connection succeeds. Watches start working.

---

## Security Notes

1. **App passwords only.** Never ask for or store the main account password. Gmail, iCloud, and most providers support app-specific passwords.
2. **Credentials in config file, not DB.** `~/.cogload/config.json` has user-level read permissions. The database is separate and doesn't contain credentials.
3. **Headers only.** The IMAP client fetches ENVELOPE data (from, subject, date, message-id). The email body is never fetched, never stored, never sent over the API.
4. **TLS only.** All IMAP connections use TLS (`DialTLS`). No plaintext option.
5. **Rate limiting.** The watcher enforces a minimum 60-second gap between checks per watch, with a configurable `check_every_sec` (minimum 60s, default 300s).

---

## Files Changed

| File | Change |
|---|---|
| `backend/internal/store/store.go` | 2 new tables, 6 new methods |
| `backend/internal/models/models.go` | `EmailWatch`, `EmailMatch` types |
| `backend/internal/config/config.go` | `EmailConfig` struct in `Config` |
| `backend/internal/ingest/emailwatcher.go` | New file — IMAP polling watcher |
| `backend/internal/ingest/coordinator.go` | Add `EmailWatcher` field + lifecycle |
| `backend/internal/api/router.go` | 6 new endpoints |
| `backend/cmd/cogload/main.go` | Pass hub to coordinator (for WS broadcast) |
| `frontend/src/types/index.ts` | `EmailWatch`, `EmailMatch` interfaces |
| `frontend/src/api/client.ts` | 4 new methods |
| `frontend/src/store/ws-client.ts` | Handle `email_match` event type |
| `frontend/src/store/app-store.ts` | `emailMatches` slice |
| `frontend/src/components/shared/TaskNode.tsx` | `hasEmailMatch` state + envelope icon |
| `frontend/src/components/modes/MapMode.tsx` | `EmailWatchPanel` in `TaskControlPanel` |
| `frontend/src/components/modes/SettingsMode.tsx` | Email credentials section |
| `frontend/src/styles/map.css` | `.tnode--email-match`, `.ewp-*` classes |

---

## Open Questions

1. **OAuth vs App Password** — Gmail is deprecating basic auth for some account types. If the user has 2FA enabled, an App Password is required. If 2FA is not enabled, basic auth may still work. Should the plan include OAuth2 support (significantly more complex)? For v1, App Password only.

2. **Multiple mailboxes** — Search only covers INBOX. Should it also check other folders (e.g., Promotions in Gmail)? For v1, INBOX only, configurable in settings later.

3. **What happens when the watch matches** — Currently the status becomes `matched` and the watcher stops checking. Should matched watches stay visible on the node permanently until the task is marked done? Recommendation: yes — the envelope icon stays on the node until the task is completed.

4. **Privacy of the "Test connection" endpoint** — The test endpoint connects to IMAP, checks authentication, and returns success/failure. It never logs the password. The password is passed in the request body (HTTPS in production, localhost in dev). Acceptable for v1.
