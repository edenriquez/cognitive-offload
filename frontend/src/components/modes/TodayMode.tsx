import { useState } from 'react'
import { useAppStore } from '../../store/app-store'
import Ring from '../shared/Ring'

export default function TodayMode() {
  const { tasks, toggleTask, bandwidth, startFocus, now } = useAppStore()
  const [revealBw, setRevealBw] = useState(false)
  const [revealCtx, setRevealCtx] = useState(false)

  const hour = now.getHours() + now.getMinutes() / 60
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const nextTask = tasks.find(t => !t.done && (t.kind === 'must' || t.kind === 'personal'))
  const total = bandwidth.work + bandwidth.personal + bandwidth.admin + bandwidth.learning

  return (
    <div className="today">
      <div className="today-inner">
        {/* Thread gravity card */}
        <div className="gravity">
          <div>
            <div className="gravity-eye">Active thread · 4h12m open</div>
            <div className="gravity-task">Ship retry-logic v2 behind a feature flag</div>
            <div className="gravity-meta">9 AI msgs · 1 commit · last touch 3m ago</div>
          </div>
          <button className="btn-primary" onClick={() => startFocus('Ship retry-logic v2 behind a feature flag')}>
            Resume →
          </button>
        </div>

        {/* Inline guidance ribbon */}
        <div className="ribbon danger">
          <span className="pulse-dot"></span>
          <span><b>Fragmentation rising.</b> 7 AI sessions in last 30 min · output ↓ vs peak.</span>
          <span className="ribbon-redirect" onClick={() => startFocus('Ship retry-logic v2 behind a feature flag')}>
            Continue current thread →
          </span>
        </div>

        <div className="today-greet">{greet} · day 14</div>
        <div className="today-q">
          The one thing right now is <em>{nextTask ? nextTask.text.toLowerCase() : "rest. you're done."}</em>
        </div>

        <div className="ttasks">
          {tasks.map(t => (
            <div key={t.id} className={`ttask ${t.done ? 'done' : ''} ${t.id === nextTask?.id ? 'active' : ''}`}>
              <span className={`ttask-rank ${t.kind}`}>
                {t.kind === 'must' ? `Must ${t.idx}` : t.kind === 'personal' ? 'Personal' : 'Small'}
              </span>
              <div className="ttask-text">{t.text}</div>
              {t.id === nextTask?.id && !t.done ? (
                <button className="ttask-go" onClick={() => startFocus(t.text)}>Focus</button>
              ) : (
                <span className="ttask-check" onClick={() => toggleTask(t.id)}></span>
              )}
            </div>
          ))}
        </div>

        <div className="reveal-row">
          <button className={`reveal-pill ${revealBw ? 'on' : ''}`} onClick={() => setRevealBw(b => !b)}>
            {revealBw ? 'Hide bandwidth' : 'Show bandwidth'}
          </button>
          <button className={`reveal-pill ${revealCtx ? 'on' : ''}`} onClick={() => setRevealCtx(b => !b)}>
            {revealCtx ? 'Hide context' : 'Show context'}
          </button>
        </div>

        <div className={`reveal-content ${revealBw ? 'on' : ''}`}>
          <div className="ring-row">
            <Ring alloc={bandwidth} />
            <div className="ring-legend">
              <span><i style={{ background: '#1c1d1f' }}></i>Work core</span><b>{bandwidth.work}%</b>
              <span><i style={{ background: '#407ff2' }}></i>Personal</span><b>{bandwidth.personal}%</b>
              <span><i style={{ background: '#8f99a8' }}></i>Admin</span><b>{bandwidth.admin}%</b>
              <span><i style={{ background: '#d3d8df' }}></i>Learning</span><b>{bandwidth.learning}%</b>
            </div>
          </div>
          <div className="ctx-line">Allocated · {total}% &nbsp;·&nbsp; Cutoff · 16:30 &nbsp;·&nbsp; Productive · 6h</div>
        </div>

        <div className={`reveal-content ${revealCtx ? 'on' : ''}`}>
          <div className="ctx-line" style={{ textAlign: 'left', padding: '0 8px', lineHeight: 1.7, fontSize: 13 }}>
            Must 1 → roadmap "auth-success 87 → 92%" · projected +8%<br />
            Must 2 → roadmap "alerts/wk 21 → 12" · projected −4 alerts<br />
            Personal task is below 10% bandwidth floor · <span className="danger">3rd consecutive day</span>
          </div>
        </div>
      </div>
    </div>
  )
}
