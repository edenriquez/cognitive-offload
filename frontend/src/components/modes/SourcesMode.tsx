import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { SourceStatus } from "../../types";

// Official brand SVGs (Simple Icons) + Lucide for utilities
function Icon({ type, name }: { type: string; name: string }) {
  const lowerName = name.toLowerCase();

  // Claude brand mark (Simple Icons — claude)
  if (lowerName.includes("claude")) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
      </svg>
    );
  }

  // Zed brand mark (Simple Icons — zedindustries)
  if (lowerName.includes("zed")) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z" />
      </svg>
    );
  }

  // Git brand mark (Simple Icons)
  if (type === "git") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.09 23.549a1.54 1.54 0 0 1-2.18 0L.451 13.089a1.54 1.54 0 0 1 0-2.179l7.191-7.19 2.733 2.733a1.85 1.85 0 0 0 .964 2.326v6.66a1.849 1.849 0 1 0 1.54 0V8.957l2.508 2.508a1.85 1.85 0 1 0 1.09-1.09l-2.634-2.634a1.85 1.85 0 0 0-2.378-2.377L8.73 2.63 10.91.451a1.54 1.54 0 0 1 2.179 0l10.459 10.46a1.54 1.54 0 0 1 0 2.179z" />
      </svg>
    );
  }

  // Lucide: file-text (File Watcher)
  if (type === "file_watcher") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
        <path d="M14 2v5a1 1 0 0 0 1 1h5" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>
    );
  }

  // Lucide: clock (Idle Detector)
  if (type === "idle") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  }

  // Lucide: bar-chart-3 (Aggregator)
  if (type === "aggregator") {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </svg>
    );
  }

  // Default: Lucide circle
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l2 2" />
    </svg>
  );
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
                  <Icon type={s.type} name={s.name} />
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
