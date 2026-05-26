import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type {
  ReviewSummary,
  DailyReport,
  DailySummaryRecord,
} from "../../types";
import ArcStrip from "../shared/ArcStrip";
import InsightStat from "../shared/InsightStat";
import SignalCard from "../shared/SignalCard";
import CommitmentCard from "../shared/CommitmentCard";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMin(mins: unknown): string {
  const n = typeof mins === "number" && !isNaN(mins) ? mins : 0;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewMode() {
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [trends, setTrends] = useState<DailySummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitmentSkipped, setCommitmentSkipped] = useState(false);

  const day = todayStr();

  useEffect(() => {
    Promise.all([api.getReview(day), api.getReport(day), api.getTrends(7)])
      .then(([rev, rep, tr]) => {
        if (rev) {
          setReview(rev);
        }
        if (rep) setReport(rep);
        if (tr) setTrends(tr);
      })
      .catch((err) => setError(err?.message ?? "Failed to load review"))
      .finally(() => setLoading(false));
  }, [day]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAcknowledge = async (id: string, _commitment: string) => {
    await api.acknowledgePattern(id);
  };

  const handleDismiss = async (id: string) => {
    await api.dismissPattern(id);
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rv">
        <div className="rv-inner">
          <div className="rv-header">
            <h1 className="rv-h">Review</h1>
          </div>
          <div className="rv-loading">Loading today's review…</div>
        </div>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="rv">
        <div className="rv-inner">
          <div className="rv-header">
            <h1 className="rv-h">Review</h1>
          </div>
          <p className="rv-empty">
            {error ?? "No data yet. Work for a while and check back."}
          </p>
        </div>
      </div>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const summary = review.summary ?? {
    deep_work_min: 0,
    leaked_min: 0,
    open_loops: 0,
    sessions_count: 0,
  };
  const buckets = review.energy_map ?? [];
  const patterns = (review.patterns ?? []).filter((p) => !p.dismissed);
  const selfReports = review.self_reports ?? [];
  const wallTime = report?.wall_summary
    ? extractWallTime(report.wall_summary)
    : undefined;

  // Build 7-day sparkline arrays from trends (oldest → newest)
  const trendsSorted = [...trends]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-7);
  const deepWorkTrend = trendsSorted.map((t) => t.deep_work_min);
  const leakedTrend = trendsSorted.map((t) => t.leaked_min);
  // Top suggestion for commitment card
  const topSuggestion =
    report?.suggestions && report.suggestions.length > 0
      ? report.suggestions.reduce((best, s) =>
          s.priority < best.priority ? s : best,
        )
      : null;

  // Visible patterns — at most 5, high severity first
  const sortedPatterns = [...patterns].sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    return (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1);
  });

  return (
    <div className="rv">
      <div className="rv-inner">
        {/* Header */}
        <div className="rv-header">
          <h1 className="rv-h">Review</h1>
          <span className="rv-date">{formatDateHeader(day)}</span>
          <span className="rv-sub">Auto-generated from activity logs</span>
        </div>

        {/* ── Section 1: The Arc ──────────────────────────────────────────── */}
        <section className="rv-section">
          <ArcStrip
            buckets={buckets}
            selfReports={selfReports}
            wallTime={wallTime}
          />
        </section>

        {/* ── Section 2: Three Numbers ────────────────────────────────────── */}
        <section className="rv-section rv-section--stats">
          <InsightStat
            value={fmtMin(summary.deep_work_min)}
            label="Deep work"
            trend={deepWorkTrend}
            higherIsBetter={true}
          />
          <InsightStat
            value={fmtMin(summary.leaked_min)}
            label="Leaked time"
            trend={leakedTrend}
            higherIsBetter={false}
            danger={summary.leaked_min > 60}
          />
        </section>

        {/* ── Section 3: Signal Cards ─────────────────────────────────────── */}
        {sortedPatterns.length > 0 && (
          <section className="rv-section">
            <h2 className="rv-section-h">What happened</h2>
            <p className="rv-section-sub">
              {sortedPatterns.length} signal
              {sortedPatterns.length !== 1 ? "s" : ""} detected. Expand each to
              understand the impact and commit to a fix.
            </p>
            <div className="rv-signals">
              {sortedPatterns.map((p) => (
                <SignalCard
                  key={p.id}
                  pattern={p}
                  onAcknowledge={handleAcknowledge}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Section 4: One Thing To Change ─────────────────────────────── */}
        {topSuggestion && !commitmentSkipped && (
          <section className="rv-section">
            <h2 className="rv-section-h">One thing to change</h2>
            <CommitmentCard
              suggestion={topSuggestion}
              onCommit={() => {}}
              onSkip={() => setCommitmentSkipped(true)}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function extractWallTime(wallSummary: string): string | undefined {
  // Tries to find a time like "3:15 PM" or "15:15" in the wall summary string
  const match = wallSummary.match(/\b(\d{1,2}:\d{2}(?:\s?[AP]M)?)\b/i);
  return match ? match[1] : undefined;
}
