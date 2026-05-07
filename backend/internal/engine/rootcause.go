package engine

import (
	"context"
	"fmt"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// InferRootCauses correlates detected patterns with likely causes.
func InferRootCauses(ctx context.Context, db *store.DB, day string) []models.RootCause {
	patterns, err := db.PatternsByDay(ctx, day)
	if err != nil || len(patterns) == 0 {
		return nil
	}

	sessions, _ := db.SessionsByDay(ctx, day)
	buckets, _ := db.BucketsByDay(ctx, day)

	var causes []models.RootCause

	for _, p := range patterns {
		switch p.Kind {
		case "thrashing":
			count := 0
			if v, ok := p.Evidence["count"]; ok {
				if n, ok := v.(float64); ok {
					count = int(n)
				}
			}
			causes = append(causes, models.RootCause{
				Signal:     fmt.Sprintf("%d sessions / 30m", count),
				Cause:      "No active-thread cap — context-switch tax",
				Confidence: 90,
			})

		case "crash":
			drop := 0
			if v, ok := p.Evidence["drop_pct"]; ok {
				if n, ok := v.(float64); ok {
					drop = int(n)
				}
			}
			causes = append(causes, models.RootCause{
				Signal:     fmt.Sprintf("−%d%% post-lunch dip", drop),
				Cause:      "Heavy cognitive load immediately after meal",
				Confidence: 75,
			})

		case "fatigue":
			spike := 0
			if v, ok := p.Evidence["error_spike_pct"]; ok {
				if n, ok := v.(float64); ok {
					spike = int(n)
				}
			}
			causes = append(causes, models.RootCause{
				Signal:     fmt.Sprintf("+%d%% error spike past cutoff", spike),
				Cause:      "Working past cutoff under fatigue",
				Confidence: 85,
			})

		case "stuck":
			dur := 0
			if v, ok := p.Evidence["duration_min"]; ok {
				if n, ok := v.(float64); ok {
					dur = int(n)
				}
			}
			causes = append(causes, models.RootCause{
				Signal:     fmt.Sprintf("Session open %dm with low progress", dur),
				Cause:      "Task too large or unclear — needs splitting",
				Confidence: 70,
			})

		case "open-loops":
			count := 0
			if v, ok := p.Evidence["open_count"]; ok {
				if n, ok := v.(float64); ok {
					count = int(n)
				}
			}
			causes = append(causes, models.RootCause{
				Signal:     fmt.Sprintf("%d open threads", count),
				Cause:      "No close-or-archive enforcement",
				Confidence: 80,
			})
		}
	}

	// Additional cause: if many sessions but few file saves → output imbalance
	totalSessions := len(sessions)
	totalSaves := 0
	for _, b := range buckets {
		totalSaves += b.FileSaves
	}
	if totalSessions > 5 && totalSaves < totalSessions {
		causes = append(causes, models.RootCause{
			Signal:     fmt.Sprintf("%d sessions, %d file saves", totalSessions, totalSaves),
			Cause:      "High AI interaction with low code output",
			Confidence: 65,
		})
	}

	return causes
}
