package engine

import (
	"context"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// ComputeDaySummary calculates deep work, leaked time, etc. from buckets.
func ComputeDaySummary(ctx context.Context, db *store.DB, day string) models.DaySummary {
	buckets, err := db.BucketsByDay(ctx, day)
	if err != nil {
		return models.DaySummary{}
	}

	sessions, _ := db.SessionsByDay(ctx, day)

	deepWorkMin := 0
	totalActiveMin := 0
	totalWorkMin := 0

	for _, b := range buckets {
		// Skip non-work hours
		if b.Hour < 8.0 || b.Hour > 18.0 {
			continue
		}
		totalWorkMin += 10 // each bucket = 10 min

		if b.Activity > 10 {
			totalActiveMin += 10
		}

		// Deep work = high activity + low errors + low session switching
		if b.Activity >= 50 && b.Errors <= 1 && b.Sessions <= 1 {
			deepWorkMin += 10
		}
	}

	leakedMin := totalWorkMin - totalActiveMin
	if leakedMin < 0 {
		leakedMin = 0
	}

	openLoops := 0
	for _, s := range sessions {
		if s.Status != "closed" {
			openLoops++
		}
	}

	return models.DaySummary{
		DeepWorkMin:   deepWorkMin,
		LeakedMin:     leakedMin,
		OpenLoops:     openLoops,
		SessionsCount: len(sessions),
	}
}
