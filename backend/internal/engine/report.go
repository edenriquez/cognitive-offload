package engine

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/cogload/backend/internal/models"
	"github.com/cogload/backend/internal/store"
)

// DailyReport is the narrative daily intelligence report.
type DailyReport struct {
	Day         string          `json:"day"`
	Sections    []ReportSection `json:"sections"`
	Suggestions []Suggestion    `json:"suggestions"`
	WallSummary string          `json:"wall_summary,omitempty"`
}

// ReportSection is one section of the daily report.
type ReportSection struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

// Suggestion is an actionable recommendation.
type Suggestion struct {
	Priority int    `json:"priority"` // 1=highest
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Metric   string `json:"metric"` // what to measure improvement against
}

// GenerateReport builds the full daily intelligence report.
func GenerateReport(ctx context.Context, db *store.DB, day string) DailyReport {
	report := DailyReport{Day: day}

	// Gather data from other engine functions and the store.
	summary := ComputeDaySummary(ctx, db, day)
	sessions, _ := db.SessionsByDay(ctx, day)
	patterns, _ := db.PatternsByDay(ctx, day)
	momentum := ComputeMomentum(ctx, db, day)
	scores := ScoreAllSessions(ctx, db, day)
	scoreSummary := SummarizeSessionScores(scores)
	selfReports, _ := db.SelfReportsByDay(ctx, day)

	// Section 1: What you accomplished
	accomplishment := fmt.Sprintf(
		"You logged %d minutes of deep work across %d AI sessions. "+
			"%d file saves and %d git commits were recorded.",
		summary.DeepWorkMin, summary.SessionsCount,
		momentum.TotalSaves, momentum.TotalCommits,
	)
	if scoreSummary.HighLeverage > 0 {
		accomplishment += fmt.Sprintf(
			" %d sessions were high-leverage (avg score %d/100).",
			scoreSummary.HighLeverage, int(scoreSummary.AvgHighScore),
		)
	}
	report.Sections = append(report.Sections, ReportSection{
		Title:   "What you accomplished",
		Content: accomplishment,
	})

	// Section 2: Where time went
	if summary.LeakedMin > 0 {
		timeSection := fmt.Sprintf(
			"%d minutes leaked to inactivity or low-output periods. "+
				"Active deep work covered %d minutes of the day.",
			summary.LeakedMin, summary.DeepWorkMin,
		)
		report.Sections = append(report.Sections, ReportSection{
			Title:   "Where time went",
			Content: timeSection,
		})
	}

	// Section 3: Cognitive arc
	arcContent := fmt.Sprintf(
		"Peak velocity reached %.0f events/hour. Current velocity is %.0f events/hour.",
		momentum.PeakVelocity, momentum.Velocity,
	)
	if momentum.Acceleration < -0.3 {
		arcContent += fmt.Sprintf(
			" Velocity has dropped %.0f%% — you are decelerating.",
			math.Abs(momentum.Acceleration)*100,
		)
	}
	report.Sections = append(report.Sections, ReportSection{
		Title:   "Cognitive arc",
		Content: arcContent,
	})

	// Section 4: E-bike wall
	if momentum.WallDetected {
		wallMsg := fmt.Sprintf(
			"Your output-per-message ratio dropped significantly. "+
				"The e-bike wall hit at approximately %s. "+
				"You kept opening sessions but producing less code output. "+
				"The momentum was easier to maintain than the output.",
			momentum.WallTime,
		)
		report.WallSummary = wallMsg
		report.Sections = append(report.Sections, ReportSection{
			Title:   "The e-bike wall",
			Content: wallMsg,
		})
	}

	// Section 5: Patterns
	if len(patterns) > 0 {
		var patternLines []string
		for _, p := range patterns {
			patternLines = append(patternLines,
				fmt.Sprintf("- %s (%s): %s", p.Title, p.Severity, p.Detail),
			)
		}
		report.Sections = append(report.Sections, ReportSection{
			Title:   "Patterns detected",
			Content: strings.Join(patternLines, "\n"),
		})
	}

	// Section 6: Self-report correlation
	if len(selfReports) > 0 {
		last := selfReports[len(selfReports)-1]
		srContent := fmt.Sprintf(
			"You self-reported as '%s' (level %d/5).",
			last.Label, last.Level,
		)
		if last.Level >= 4 && momentum.WallDetected {
			reportTime := time.UnixMilli(last.Ts).Format("15:04")
			srContent += fmt.Sprintf(
				" This aligns with the momentum decline — you reported degradation at %s.",
				reportTime,
			)
		}
		report.Sections = append(report.Sections, ReportSection{
			Title:   "Self-reported state",
			Content: srContent,
		})
	}

	// Generate suggestions
	report.Suggestions = generateSuggestions(summary, momentum, scoreSummary, patterns, sessions)

	return report
}

// generateSuggestions produces up to 3 prioritized actionable recommendations.
func generateSuggestions(
	summary models.DaySummary,
	momentum Momentum,
	scoreSummary SessionScoreSummary,
	patterns []models.Pattern,
	sessions []models.Session,
) []Suggestion {
	var suggestions []Suggestion

	// Suggestion: Low-output sessions dominate
	if scoreSummary.LowOutput > 0 && scoreSummary.LowOutput > scoreSummary.HighLeverage {
		suggestions = append(suggestions, Suggestion{
			Priority: 1,
			Title:    "Reduce spinning-wheels sessions",
			Detail: fmt.Sprintf(
				"%d of %d sessions had low output scores (<30). "+
					"Before opening a new AI thread, define the expected output first.",
				scoreSummary.LowOutput, scoreSummary.TotalSessions,
			),
			Metric: "Low-output sessions < 2 tomorrow",
		})
	}

	// Suggestion: E-bike wall detected
	if momentum.WallDetected {
		suggestions = append(suggestions, Suggestion{
			Priority: 1,
			Title:    "Stop before the wall",
			Detail: fmt.Sprintf(
				"Output-per-message decayed past the wall at %s. "+
					"Plan to wrap up complex work 1 hour before that time tomorrow.",
				momentum.WallTime,
			),
			Metric: "No new sessions after wall time",
		})
	}

	// Suggestion: Too many sessions
	if len(sessions) > 8 {
		suggestions = append(suggestions, Suggestion{
			Priority: 2,
			Title:    "Fewer, longer sessions",
			Detail: fmt.Sprintf(
				"You opened %d sessions today. Try capping at 6 and making each one "+
					"produce a tangible output before moving on.",
				len(sessions),
			),
			Metric: "<=6 sessions tomorrow with avg score >=50",
		})
	}

	// Suggestion: Low deep work
	if summary.DeepWorkMin < 120 {
		suggestions = append(suggestions, Suggestion{
			Priority: 2,
			Title:    "Protect deep work blocks",
			Detail: fmt.Sprintf(
				"Only %d minutes of deep work today. "+
					"Block a 2-hour morning slot with no new threads allowed.",
				summary.DeepWorkMin,
			),
			Metric: ">=120 min deep work tomorrow",
		})
	}

	// Suggestion: High leaked time
	if summary.LeakedMin > 60 {
		suggestions = append(suggestions, Suggestion{
			Priority: 3,
			Title:    "Reduce idle gaps",
			Detail: fmt.Sprintf(
				"%d minutes leaked to inactivity. "+
					"Schedule light tasks or breaks in advance rather than drifting.",
				summary.LeakedMin,
			),
			Metric: "Leaked time <45 min tomorrow",
		})
	}

	// Suggestion: Performance degradation pattern
	for _, p := range patterns {
		if p.Kind == "perf-degradation" {
			suggestions = append(suggestions, Suggestion{
				Priority: 1,
				Title:    "Reduce context switching",
				Detail: "Performance degradation was detected from too many concurrent threads. " +
					"Focus on finishing one thread before starting another.",
				Metric: "Max 2 concurrent threads at any time",
			})
			break
		}
	}

	// Cap at 3 suggestions, keeping highest-priority ones.
	if len(suggestions) > 3 {
		suggestions = suggestions[:3]
	}

	return suggestions
}
