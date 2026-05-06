import { useEffect } from 'react'
import { useAppStore } from './store/app-store'
import type { Mode } from './types'
import FocusMode from './components/modes/FocusMode'
import TodayMode from './components/modes/TodayMode'
import CaptureMode from './components/modes/CaptureMode'
import ReviewMode from './components/modes/ReviewMode'
import TomorrowMode from './components/modes/TomorrowMode'
import './styles/desktop.css'
import './styles/modes.css'

const MODES: { id: Mode; label: string }[] = [
  { id: 'focus', label: 'Focus' },
  { id: 'today', label: 'Today' },
  { id: 'capture', label: 'Capture' },
  { id: 'review', label: 'Review' },
  { id: 'tomorrow', label: 'Tomorrow' },
]

function suggestedMode(hour: number): Mode {
  if (hour < 9) return 'tomorrow'
  if (hour < 17) return 'today'
  if (hour < 20) return 'review'
  return 'today'
}

export default function App() {
  const {
    mode, setMode, tasks, setTasks,
    activeFocusTask, startFocus, exitFocus,
    toast, setToast, now, setNow, signals,
  } = useAppStore()

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [setNow])

  // Demo toast
  useEffect(() => {
    const t = setTimeout(() => setToast({
      msg: 'Detected 3 open AI threads. Close one before starting new work.',
      action: 'Triage',
    }), 4000)
    return () => clearTimeout(t)
  }, [setToast])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') setMode('today')
        return
      }
      if (e.key === '1') setMode('focus')
      if (e.key === '2') setMode('today')
      if (e.key === '3') setMode('capture')
      if (e.key === '4') setMode('review')
      if (e.key === '5') setMode('tomorrow')
      if (e.key === 'Escape') setMode('today')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  // Fetch initial tasks (fallback to demo data if backend not running)
  useEffect(() => {
    fetch('/api/v1/today')
      .then(r => r.json())
      .then(data => { if (data.tasks) setTasks(data.tasks) })
      .catch(() => {
        setTasks([
          { id: 'm1', day: '', kind: 'must', idx: 1, text: 'Ship retry-logic v2 behind a feature flag', done: false },
          { id: 'm2', day: '', kind: 'must', idx: 2, text: 'Tune p99 latency alerts — drop noise from on-call', done: false },
          { id: 'm3', day: '', kind: 'must', idx: 3, text: 'Draft post-mortem for Tuesday outage', done: true },
          { id: 'p1', day: '', kind: 'personal', idx: 1, text: 'Outline chapter 3 of side-project (45m)', done: false },
        ])
      })
  }, [setTasks])

  const hour = now.getHours() + now.getMinutes() / 60
  const auto = suggestedMode(hour)
  const completed = tasks.filter(t => t.done).length

  // Signals from WebSocket or defaults
  const sig = signals ?? {
    focus_state: 'thrashing' as const,
    active_threads: 3,
    error_rate: 2.8,
    error_baseline: 1.0,
    open_loops: 4,
    cutoff_hour: 16.5,
    cognitive_threshold_pct: 87,
    interventions: [],
  }

  const cutoffHH = Math.floor(sig.cutoff_hour)
  const cutoffMM = Math.round((sig.cutoff_hour % 1) * 60).toString().padStart(2, '0')

  return (
    <div className="app-shell">
      {/* Top nav — sits under native titlebar overlay area */}
      <div className="topnav" data-tauri-drag-region="">
        <div className="nav-brand"><i>c</i>Cogload</div>
        <div className="nav-pills">
          {MODES.map(m => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <span className="auto-hint">auto · {auto}</span>
          <span><b>{completed}</b>/{tasks.length} closed</span>
        </div>
      </div>

      {/* Signal strip */}
      <div className="signals">
        <div className="signal">
          <span className={`sd ${sig.focus_state === 'thrashing' ? 'danger' : sig.active_threads >= 2 ? 'warn' : ''}`}></span>
          <span className="signal-label">Focus</span>
          <b>{sig.focus_state}</b>
        </div>
        <div className="signal">
          <span className={`sd ${sig.active_threads >= 3 ? 'danger' : 'warn'}`}></span>
          <span className="signal-label">Threads</span>
          <b>{sig.active_threads}</b>
          <span style={{ color: 'var(--color-overcast)' }}>active</span>
        </div>
        <div className="signal">
          <span className={`sd ${sig.error_rate > 2 ? 'danger' : sig.error_rate > 1.3 ? 'warn' : ''}`}></span>
          <span className="signal-label">Errors</span>
          <b>{sig.error_rate.toFixed(1)}×</b>
          <span style={{ color: 'var(--color-overcast)' }}>baseline</span>
        </div>
        <div className="signal">
          <span className="sd"></span>
          <span className="signal-label">Loops</span>
          <b>{sig.open_loops}</b>
          <span style={{ color: 'var(--color-overcast)' }}>open</span>
        </div>
        <div className="signal">
          <span className={`sd ${hour > sig.cutoff_hour ? 'danger' : ''}`}></span>
          <span className="signal-label">Cutoff</span>
          <b>{cutoffHH}:{cutoffMM}</b>
          <span style={{ color: 'var(--color-overcast)' }}>
            {hour > sig.cutoff_hour ? 'past' : `in ${Math.round((sig.cutoff_hour - hour) * 60)}m`}
          </span>
        </div>
        <div className="signal" style={{ marginLeft: 'auto', color: 'var(--color-overcast)' }}>
          {sig.interventions.length} active rule{sig.interventions.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Main content */}
      <div className="content-area">
        <div className="stage">
          {mode === 'focus' && (
            <FocusMode
              task={activeFocusTask || tasks.find(t => !t.done && t.kind === 'must')?.text || 'Pick a task'}
              onExit={exitFocus}
            />
          )}
          {mode === 'today' && <TodayMode />}
          {mode === 'capture' && <CaptureMode />}
          {mode === 'review' && <ReviewMode />}
          {mode === 'tomorrow' && <TomorrowMode />}
        </div>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span>
          <span className={`sb-dot ${toast ? 'warn' : ''}`}></span>
          {toast ? '3 open threads' : 'all signals nominal'}
        </span>
        <span>Sessions · <b>11</b></span>
        <span>Errors · <b>2</b></span>
        <span>Cutoff · <b>{cutoffHH}:{cutoffMM}</b></span>
        <div className="sb-spacer"></div>
        {toast && <span className="sb-link" onClick={() => setToast(null)}>Triage threads →</span>}
        <span>v0.5 · synced</span>
      </div>

      {/* Toast */}
      {toast && mode !== 'focus' && (
        <div className="toast on">
          <span className="toast-dot"></span>
          <span>{toast.msg}</span>
          <button className="toast-action" onClick={() => setToast(null)}>{toast.action}</button>
          <button className="toast-action muted" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
    </div>
  )
}
