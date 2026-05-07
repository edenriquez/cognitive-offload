package engine

import (
	"context"
	"fmt"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// ComputeLeaks identifies time windows where energy was lost.
func ComputeLeaks(ctx context.Context, db *store.DB, day string) []models.Leak {
	buckets, err := db.BucketsByDay(ctx, day)
	if err != nil || len(buckets) == 0 {
		return nil
	}

	var leaks []models.Leak

	// 1. Find idle gaps during work hours (activity drops to near-zero for 20+ min)
	inGap := false
	gapStart := 0
	for i, b := range buckets {
		if b.Hour < 8.0 || b.Hour > 18.0 {
			continue
		}
		if b.Activity < 5 && !inGap {
			inGap = true
			gapStart = i
		} else if b.Activity >= 5 && inGap {
			gapLen := i - gapStart
			if gapLen >= 2 { // 20+ min gap
				startH := buckets[gapStart].Hour
				endH := b.Hour
				leaks = append(leaks, models.Leak{
					Time:  fmt.Sprintf("%s–%s", fmtHour(startH), fmtHour(endH)),
					Cost:  fmt.Sprintf("−%dm", gapLen*10),
					Cause: "Inactivity gap",
					Fix:   "Schedule break or plan light tasks",
				})
			}
			inGap = false
		}
	}

	// 2. High-error windows (error rate above threshold)
	for _, b := range buckets {
		if b.Errors >= 3 && b.Activity > 10 {
			leaks = append(leaks, models.Leak{
				Time:  fmt.Sprintf("%s–%s", fmtHour(b.Hour), fmtHour(b.Hour+10.0/60.0)),
				Cost:  fmt.Sprintf("%d errors", b.Errors),
				Cause: "Error-heavy window",
				Fix:   "Fix environment or take a break",
			})
		}
	}

	// 3. Session context-fragmentation windows (many sessions, low file saves)
	for _, b := range buckets {
		if b.Sessions >= 3 && b.FileSaves <= 1 && b.Activity > 10 {
			leaks = append(leaks, models.Leak{
				Time:  fmt.Sprintf("%s–%s", fmtHour(b.Hour), fmtHour(b.Hour+10.0/60.0)),
				Cost:  "−10m",
				Cause: fmt.Sprintf("Context switching (%d sessions, %d saves)", b.Sessions, b.FileSaves),
				Fix:   "Cap at 1 active thread",
			})
		}
	}

	// 4. Post-cutoff work
	for _, b := range buckets {
		if b.Hour >= 16.5 && b.Activity > 20 {
			leaks = append(leaks, models.Leak{
				Time:  fmt.Sprintf("%s–%s", fmtHour(b.Hour), fmtHour(b.Hour+10.0/60.0)),
				Cost:  "quality",
				Cause: "Work past cutoff",
				Fix:   "Hard stop at cutoff",
			})
			break // Only report once
		}
	}

	return leaks
}

func fmtHour(h float64) string {
	hh := int(h)
	mm := int((h - float64(hh)) * 60)
	return fmt.Sprintf("%02d:%02d", hh, mm)
}
