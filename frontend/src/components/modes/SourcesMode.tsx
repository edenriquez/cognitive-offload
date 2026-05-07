import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { SourceStatus } from '../../types'

const TYPE_ICONS: Record<string, string> = {
  file_watcher: '📁',
  git: '🔀',
  llm: '🤖',
  idle: '💤',
  aggregator: '📊',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--color-success-green)',
  inactive: 'var(--color-overcast)',
  error: 'var(--color-danger-red)',
  not_found: 'var(--color-warning-yellow)',
}

export default function SourcesMode() {
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSources = () => {
      api.getSources()
        .then(data => { if (Array.isArray(data)) setSources(data) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    fetchSources()
    const interval = setInterval(fetchSources, 10_000) // refresh every 10s
    return () => clearInterval(interval)
  }, [])

  const totalEvents = sources.reduce((sum, s) => sum + (s.events_today ?? 0), 0)
  const activeSources = sources.filter(s => s.status === 'active').length

  if (loading) {
    return (
      <div className="sources">
        <div className="sources-inner">
          <h1 className="sources-h">Data Sources</h1>
          <div className="sources-sub">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="sources">
      <div className="sources-inner">
        <h1 className="sources-h">Data Sources</h1>
        <div className="sources-sub">
          {activeSources} active · {totalEvents} events today · refreshes every 10s
        </div>

        <div className="sources-grid">
          {sources.map((s, i) => (
            <div key={i} className={`source-card ${s.status}`}>
              <div className="source-card-header">
                <span className="source-icon">{TYPE_ICONS[s.type] ?? '📡'}</span>
                <span className="source-name">{s.name}</span>
                <span className="source-status-dot" style={{ background: STATUS_COLORS[s.status] ?? 'var(--color-overcast)' }}></span>
                <span className="source-status-label">{s.status}</span>
              </div>
              <div className="source-detail">{s.detail}</div>
              <div className="source-events">
                <span className="source-events-count">{s.events_today ?? 0}</span>
                <span className="source-events-label">events today</span>
              </div>
            </div>
          ))}
        </div>

        {sources.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--color-overcast)', padding: '48px 0' }}>
            No data sources detected. Make sure the backend is running.
          </div>
        )}
      </div>
    </div>
  )
}
