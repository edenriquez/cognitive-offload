package ingest

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

type GitMonitor struct {
	db         *store.DB
	paths      []string
	lastCommit map[string]string // repo path → last seen commit hash
	lastBranch map[string]string // repo path → last seen branch
	mu         sync.Mutex
	stopCh     chan struct{}
}

func NewGitMonitor(db *store.DB, watchPaths []string) *GitMonitor {
	return &GitMonitor{
		db:         db,
		paths:      watchPaths,
		lastCommit: make(map[string]string),
		lastBranch: make(map[string]string),
		stopCh:     make(chan struct{}),
	}
}

func (g *GitMonitor) Start(ctx context.Context) {
	// Find all git repos in watch paths
	repos := g.findGitRepos()
	if len(repos) == 0 {
		slog.Info("git monitor: no git repos found in watch paths")
		return
	}

	// Initialize last known state
	for _, repo := range repos {
		hash := g.currentCommitHash(repo)
		branch := g.currentBranch(repo)
		g.lastCommit[repo] = hash
		g.lastBranch[repo] = branch
	}

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-g.stopCh:
				return
			case <-ticker.C:
				g.poll(ctx, repos)
			}
		}
	}()

	slog.Info("git monitor started", "repos", len(repos))
}

func (g *GitMonitor) Stop() {
	close(g.stopCh)
}

func (g *GitMonitor) poll(ctx context.Context, repos []string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now()
	day := now.Format("2006-01-02")
	var events []models.RawEvent

	for _, repo := range repos {
		// Check for new commits
		hash := g.currentCommitHash(repo)
		if hash != "" && hash != g.lastCommit[repo] && g.lastCommit[repo] != "" {
			// New commit detected
			subject := g.commitSubject(repo, hash)
			stats := g.commitStats(repo, hash)
			events = append(events, models.RawEvent{
				Timestamp: now,
				Source:    "git",
				Kind:      "git_commit",
				Day:       day,
				Metadata: map[string]any{
					"repo":    repo,
					"hash":    hash,
					"subject": subject,
					"stats":   stats,
				},
			})
			slog.Info("git commit detected", "repo", filepath.Base(repo), "hash", hash[:8], "subject", subject)
		}
		g.lastCommit[repo] = hash

		// Check for branch switch
		branch := g.currentBranch(repo)
		if branch != "" && branch != g.lastBranch[repo] && g.lastBranch[repo] != "" {
			events = append(events, models.RawEvent{
				Timestamp: now,
				Source:    "git",
				Kind:      "git_branch_switch",
				Day:       day,
				Metadata: map[string]any{
					"repo": repo,
					"from": g.lastBranch[repo],
					"to":   branch,
				},
			})
			slog.Info("git branch switch", "repo", filepath.Base(repo), "from", g.lastBranch[repo], "to", branch)
		}
		g.lastBranch[repo] = branch
	}

	if len(events) > 0 {
		if err := g.db.InsertEvents(ctx, events); err != nil {
			slog.Error("git monitor insert failed", "error", err)
		}
	}
}

func (g *GitMonitor) findGitRepos() []string {
	var repos []string
	seen := make(map[string]bool)

	for _, root := range g.paths {
		// Check root itself
		if isGitRepo(root) && !seen[root] {
			repos = append(repos, root)
			seen[root] = true
			continue
		}

		// Check parent (common: running from backend/ but .git is at project root)
		parent := filepath.Dir(root)
		if isGitRepo(parent) && !seen[parent] {
			repos = append(repos, parent)
			seen[parent] = true
		}

		// Check immediate children
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			path := filepath.Join(root, e.Name())
			if isGitRepo(path) && !seen[path] {
				repos = append(repos, path)
				seen[path] = true
			}
		}
	}
	return repos
}

func isGitRepo(path string) bool {
	info, err := os.Stat(filepath.Join(path, ".git"))
	return err == nil && info.IsDir()
}

func (g *GitMonitor) currentCommitHash(repo string) string {
	out, err := exec.Command("git", "-C", repo, "rev-parse", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (g *GitMonitor) currentBranch(repo string) string {
	out, err := exec.Command("git", "-C", repo, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (g *GitMonitor) commitSubject(repo, hash string) string {
	out, err := exec.Command("git", "-C", repo, "log", "-1", "--format=%s", hash).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (g *GitMonitor) commitStats(repo, hash string) string {
	out, err := exec.Command("git", "-C", repo, "diff", "--shortstat", hash+"~1", hash).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
