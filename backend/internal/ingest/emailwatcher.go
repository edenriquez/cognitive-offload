package ingest

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
	"github.com/cogload/backend/internal/ws"
)

// EmailWatcher polls IMAP for active email watches and fires WS events on match.
type EmailWatcher struct {
	db   *store.DB
	hub  *ws.Hub
	cfg  func() *models.EmailConfig // live config accessor
	stop chan struct{}
}

func NewEmailWatcher(db *store.DB, hub *ws.Hub, cfg func() *models.EmailConfig) *EmailWatcher {
	return &EmailWatcher{
		db:   db,
		hub:  hub,
		cfg:  cfg,
		stop: make(chan struct{}),
	}
}

func (w *EmailWatcher) Start(ctx context.Context) {
	go w.loop(ctx)
}

func (w *EmailWatcher) Stop() {
	select {
	case <-w.stop:
	default:
		close(w.stop)
	}
}

func (w *EmailWatcher) loop(ctx context.Context) {
	// Master tick: check every 60s which watches are due
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	slog.Info("emailwatcher: started, first check in 5s")
	// Short delay so the DB is fully ready before first check
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Second):
	}
	w.checkAll(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-w.stop:
			return
		case <-ticker.C:
			w.checkAll(ctx)
		}
	}
}

func (w *EmailWatcher) checkAll(ctx context.Context) {
	cfg := w.cfg()
	if cfg == nil || cfg.IMAPServer == "" {
		slog.Info("emailwatcher: no IMAP credentials configured — skipping (add them in Settings > Email Watch)")
		return
	}

	watches, err := w.db.ActiveEmailWatches(ctx)
	if err != nil {
		slog.Error("emailwatcher: failed to load watches", "error", err)
		return
	}
	slog.Info("emailwatcher: tick", "active_watches", len(watches), "imap_server", cfg.IMAPServer)
	if len(watches) == 0 {
		return
	}

	now := time.Now().Unix()
	for _, watch := range watches {
		sinceLastCheck := now - watch.LastCheckedAt
		if sinceLastCheck < int64(watch.CheckEverySec) {
			slog.Info("emailwatcher: skipping watch (interval not elapsed)",
				"watch", watch.ID, "task", watch.TaskID,
				"next_check_in_sec", int64(watch.CheckEverySec)-sinceLastCheck)
			continue
		}
		slog.Info("emailwatcher: checking watch",
			"watch", watch.ID, "task", watch.TaskID,
			"from_filter", watch.FromFilter, "subject_filter", watch.SubjectFilter)
		w.checkWatch(ctx, watch, cfg)
	}
}

func (w *EmailWatcher) checkWatch(ctx context.Context, watch models.EmailWatch, cfg *models.EmailConfig) {
	now := time.Now().Unix()
	// Mark last-checked immediately so concurrent ticks don't double-fire
	if err := w.db.MarkEmailWatchChecked(ctx, watch.ID, now); err != nil {
		slog.Warn("emailwatcher: failed to mark checked", "watch", watch.ID, "error", err)
	}

	slog.Info("emailwatcher: dialing IMAP", "server", cfg.IMAPServer, "user", cfg.Username)

	// Connect to IMAP
	c, err := dialIMAP(cfg)
	if err != nil {
		slog.Error("emailwatcher: IMAP connect failed", "server", cfg.IMAPServer, "error", err)
		return
	}
	defer func() { _ = c.Logout().Wait() }()

	// Login
	if err := c.Login(cfg.Username, cfg.Password).Wait(); err != nil {
		slog.Error("emailwatcher: IMAP login failed — check app password", "user", cfg.Username, "error", err)
		return
	}
	slog.Info("emailwatcher: IMAP login OK, selecting INBOX")

	// Select INBOX (read-only)
	if _, err := c.Select("INBOX", &imap.SelectOptions{ReadOnly: true}).Wait(); err != nil {
		slog.Error("emailwatcher: IMAP select INBOX failed", "error", err)
		return
	}

	// Build search criteria: UNSEEN + optional FROM + optional SUBJECT
	// Only search emails received since the watch was created
	sinceTime := time.Unix(watch.CreatedAt, 0)
	criteria := &imap.SearchCriteria{
		NotFlag: []imap.Flag{imap.FlagSeen},
		Since:   sinceTime,
	}
	if watch.FromFilter != "" {
		criteria.Header = append(criteria.Header,
			imap.SearchCriteriaHeaderField{Key: "From", Value: watch.FromFilter})
	}
	if watch.SubjectFilter != "" {
		criteria.Header = append(criteria.Header,
			imap.SearchCriteriaHeaderField{Key: "Subject", Value: watch.SubjectFilter})
	}

	searchData, err := c.Search(criteria, nil).Wait()
	if err != nil {
		slog.Warn("emailwatcher: IMAP search failed", "error", err)
		return
	}
	seqNums := searchData.AllSeqNums()
	slog.Info("emailwatcher: search complete", "watch", watch.ID, "results", len(seqNums))
	if len(seqNums) == 0 {
		slog.Info("emailwatcher: no matching email yet", "watch", watch.ID)
		return
	}

	// Fetch envelope (headers only — no body) for the first match
	seqSet := imap.SeqSetNum(seqNums[0])
	fetchOptions := &imap.FetchOptions{Envelope: true}
	messages, err := c.Fetch(seqSet, fetchOptions).Collect()
	if err != nil || len(messages) == 0 {
		slog.Warn("emailwatcher: IMAP fetch envelope failed", "error", err)
		return
	}

	msg := messages[0]
	env := msg.Envelope
	if env == nil {
		return
	}

	fromAddr := ""
	if len(env.From) > 0 {
		fromAddr = env.From[0].Addr()
	}
	subject := env.Subject
	msgID := env.MessageID
	receivedAt := now
	if !env.Date.IsZero() {
		receivedAt = env.Date.Unix()
	}

	// Double-check the filters (IMAP search is case-insensitive substring, but verify)
	if watch.FromFilter != "" &&
		!strings.Contains(strings.ToLower(fromAddr), strings.ToLower(watch.FromFilter)) {
		slog.Debug("emailwatcher: envelope from did not match filter", "from", fromAddr)
		return
	}
	if watch.SubjectFilter != "" &&
		!strings.Contains(strings.ToLower(subject), strings.ToLower(watch.SubjectFilter)) {
		slog.Debug("emailwatcher: envelope subject did not match filter", "subject", subject)
		return
	}

	// Record match
	match := models.EmailMatch{
		ID:         fmt.Sprintf("em-%d", time.Now().UnixNano()),
		WatchID:    watch.ID,
		TaskID:     watch.TaskID,
		FromAddr:   fromAddr,
		Subject:    subject,
		ReceivedAt: receivedAt,
		MessageID:  msgID,
	}
	if err := w.db.InsertEmailMatch(ctx, match); err != nil {
		slog.Error("emailwatcher: failed to insert match", "error", err)
		return
	}
	if err := w.db.MarkEmailWatchMatched(ctx, watch.ID, now); err != nil {
		slog.Error("emailwatcher: failed to mark watch matched", "error", err)
	}

	watch.Status = "matched"
	watch.MatchedAt = &now

	// Broadcast over WebSocket
	w.hub.Broadcast(models.EmailMatchEvent{
		Type:  "email_match",
		Match: match,
		Watch: watch,
	})

	slog.Info("emailwatcher: match found",
		"watch", watch.ID, "task", watch.TaskID,
		"from", fromAddr, "subject", subject)
}

func dialIMAP(cfg *models.EmailConfig) (*imapclient.Client, error) {
	if cfg.TLS {
		return imapclient.DialTLS(cfg.IMAPServer, &imapclient.Options{
			TLSConfig: &tls.Config{
				InsecureSkipVerify: false,
			},
		})
	}
	return imapclient.DialInsecure(cfg.IMAPServer, nil)
}
