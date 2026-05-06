import { useState, useEffect } from "react";
import { useAppStore } from "../../store/app-store";
import { api } from "../../api/client";
import type { ReviewSummary, Bucket } from "../../types";

function EnergyMapFromData({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0)
    return (
      <div className="em">
        <div
          className="em-area"
          style={{
            color: "var(--color-overcast)",
            display: "grid",
            placeItems: "center",
          }}
        >
          No energy data yet
        </div>
      </div>
    );
  const w = 100 / buckets.length;
  const hours = [7, 9, 11, 13, 15, 17, 19, 21];

  return (
    <div className="em">
      <div className="em-area">
        <div
          className="em-region"
          style={{
            left: `${((13 - 7) / 15) * 100}%`,
            width: `${(1 / 15) * 100}%`,
          }}
        >
          <span className="em-region-label">lunch</span>
        </div>
        <div
          className="em-region"
          style={{
            left: `${((14.5 - 7) / 15) * 100}%`,
            width: `${(1 / 15) * 100}%`,
          }}
        >
          <span className="em-region-label">thrashing</span>
        </div>
        <div
          className="em-region"
          style={{
            left: `${((16.5 - 7) / 15) * 100}%`,
            width: `${(1.5 / 15) * 100}%`,
          }}
        >
          <span className="em-region-label">past cutoff</span>
        </div>
        {buckets.map((b, i) => (
          <span
            key={i}
            className={`em-bar ${b.activity > 65 ? "peak" : b.errors > 0 ? "warn" : ""}`}
            style={{ left: `${i * w + w / 2}%`, height: `${b.activity}%` }}
          />
        ))}
        <span
          className="em-now"
          style={{
            left: `${((new Date().getHours() + new Date().getMinutes() / 60 - 7) / 15) * 100}%`,
          }}
        />
      </div>
      <div className="em-x">
        {hours.map((h) => (
          <span key={h} style={{ left: `${((h - 7) / 15) * 100}%` }}>
            {h.toString().padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </div>
  );
}

function fmtMin(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ReviewMode() {
  const setMode = useAppStore((s) => s.setMode);
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    api
      .getReview(day)
      .then((data) => setReview(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="review">
        <div className="review-inner">
          <h1 className="review-h">Today's review</h1>
          <div className="review-sub">Loading...</div>
        </div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="review">
        <div className="review-inner">
          <h1 className="review-h">Today's review</h1>
          <div className="review-sub">
            No review data available. Start the backend to generate a review.
          </div>
        </div>
      </div>
    );
  }

  const { summary, energy_map, patterns, leaks, sessions } = review;

  return (
    <div className="review">
      <div className="review-inner">
        <h1 className="review-h">Today's review</h1>
        <div className="review-sub">
          Auto-generated from logs · not self-report
        </div>

        <div className="review-summary">
          <div className="rs-cell">
            <div className="rs-v">{fmtMin(summary.deep_work_min)}</div>
            <div className="rs-l">Deep work</div>
          </div>
          <div className="rs-cell">
            <div className="rs-v danger">{fmtMin(summary.leaked_min)}</div>
            <div className="rs-l">Leaked time</div>
          </div>
          <div className="rs-cell">
            <div className="rs-v">{summary.open_loops}</div>
            <div className="rs-l">Open loops</div>
          </div>
          <div className="rs-cell">
            <div className="rs-v">{summary.sessions_count}</div>
            <div className="rs-l">Sessions</div>
          </div>
        </div>

        <div className="section">
          <h2 className="section-h">Energy map</h2>
          <div className="em-card">
            <EnergyMapFromData buckets={energy_map} />
          </div>
        </div>

        {patterns.length > 0 && (
          <div className="section">
            <h2 className="section-h">What pulled you off</h2>
            <div className="patterns">
              {patterns.map((p) => (
                <div key={p.id} className="pat">
                  <span
                    className={`pat-tag ${p.severity === "high" ? "high" : ""}`}
                  >
                    {p.kind}
                  </span>
                  <div>
                    <div className="pat-title">{p.title}</div>
                    <div className="pat-detail">{p.detail}</div>
                  </div>
                  <span className="pat-window">{p.window}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {leaks.length > 0 && (
          <div className="section">
            <h2 className="section-h">Where time leaked</h2>
            <div className="leaks">
              {leaks.map((l, i) => (
                <div key={i} className="leak">
                  <span className="leak-time">{l.time}</span>
                  <span className="leak-cost">{l.cost}</span>
                  <span className="leak-cause">{l.cause}</span>
                  <span className="leak-fix">{l.fix} →</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="tom-card">
          <div>
            <div className="tom-eye">Tomorrow's plan is ready</div>
            <div className="tom-line">
              Review complete. <b>Open the plan</b> to see auto-generated
              constraints and tasks.
            </div>
          </div>
          <button className="btn-primary" onClick={() => setMode("tomorrow")}>
            Open plan
          </button>
        </div>
      </div>
    </div>
  );
}
