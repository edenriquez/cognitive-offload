import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { SourceStatus } from "../../types";

function Icon({ type }: { type: string }) {
  const s = {
    width: 18,
    height: 18,
    viewBox: "0 0 18 18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.4",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "file_watcher":
      return (
        <svg {...s}>
          <path d="M3 2.5h7l4 4V15a1 1 0 01-1 1H4a1 1 0 01-1-1V3.5a1 1 0 011-1z" />
          <path d="M10 2.5v4h4" />
          <path d="M6 10h6M6 13h4" />
        </svg>
      );
    case "git":
      return (
        <svg {...s}>
          <circle cx="9" cy="4" r="2" />
          <circle cx="9" cy="14" r="2" />
          <circle cx="14" cy="9" r="2" />
          <path d="M9 6v6M11.5 7.5L12 8" />
        </svg>
      );
    case "llm":
      return (
        <svg {...s}>
          <rect x="3" y="3" width="12" height="10" rx="2" />
          <path d="M6 9h1M8.5 9h1M11 9h1" />
          <path d="M6 15l2-2M12 15l-2-2" />
        </svg>
      );
    case "idle":
      return (
        <svg {...s}>
          <circle cx="9" cy="9" r="7" />
          <path d="M9 5v4l3 2" />
        </svg>
      );
    case "aggregator":
      return (
        <svg {...s}>
          <path d="M3 14V8M6.5 14V6M10 14V9M13.5 14V4" />
        </svg>
      );
    default:
      return (
        <svg {...s}>
          <circle cx="9" cy="9" r="6" />
          <path d="M9 6v3l2 1" />
        </svg>
      );
  }
}

const STATUS_COLORS: Record<string, string> = {
  active: "var(--color-success-green)",
  inactive: "var(--color-overcast)",
  error: "var(--color-danger-red)",
  not_found: "var(--color-warning-yellow)",
};

export default function SourcesMode() {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSources = () => {
      api
        .getSources()
        .then((data) => {
          if (Array.isArray(data)) setSources(data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    };
    fetchSources();
    const interval = setInterval(fetchSources, 10_000);
    return () => clearInterval(interval);
  }, []);

  const totalEvents = sources.reduce(
    (sum, s) => sum + (s.events_today ?? 0),
    0,
  );
  const activeSources = sources.filter((s) => s.status === "active").length;

  if (loading) {
    return (
      <div className="sources">
        <div className="sources-inner">
          <h1 className="sources-h">Data Sources</h1>
          <div className="sources-sub">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sources">
      <div className="sources-inner">
        <h1 className="sources-h">Data Sources</h1>
        <div className="sources-sub">
          {activeSources} active · {totalEvents} events today · refreshes every
          10s
        </div>

        <div className="sources-grid">
          {sources.map((s, i) => (
            <div key={i} className={`source-card ${s.status}`}>
              <div className="source-card-header">
                <span className="source-icon">
                  <Icon type={s.type} />
                </span>
                <span className="source-name">{s.name}</span>
                <span
                  className="source-status-dot"
                  style={{
                    background:
                      STATUS_COLORS[s.status] ?? "var(--color-overcast)",
                  }}
                ></span>
                <span className="source-status-label">{s.status}</span>
              </div>
              <div className="source-detail">{s.detail}</div>
              <div className="source-events">
                <span className="source-events-count">
                  {s.events_today ?? 0}
                </span>
                <span className="source-events-label">events today</span>
              </div>
            </div>
          ))}
        </div>

        {sources.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-overcast)",
              padding: "48px 0",
            }}
          >
            No data sources detected. Make sure the backend is running.
          </div>
        )}
      </div>
    </div>
  );
}
