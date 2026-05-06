import { useState, useEffect } from 'react'

interface Props {
  task: string
  onExit: () => void
}

export default function FocusMode({ task, onExit }: Props) {
  const [secs, setSecs] = useState(22 * 60 + 14)
  const [showWhy, setShowWhy] = useState(false)

  useEffect(() => {
    document.body.classList.add('in-focus')
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => { clearInterval(t); document.body.classList.remove('in-focus') }
  }, [])

  const m = Math.floor(secs / 60)
  const s = secs % 60

  return (
    <div className="focus">
      <div className="focus-inner">
        <div className="focus-eye">Focus · 1 of 3 must-win</div>
        <div className="focus-task">{task}</div>
        <div className="focus-timer">
          {m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
        </div>
        <div className="focus-meta">remaining of 90-minute block</div>
        <div className="focus-progress"><span></span></div>
        <div className="focus-actions">
          <button className="btn-secondary" onClick={onExit}>Pause</button>
          <button className="btn-primary" onClick={onExit}>Done</button>
        </div>
        <span className="focus-reveal" onClick={() => setShowWhy(v => !v)}>
          {showWhy ? 'hide context' : 'why this task'}
        </span>
        {showWhy && (
          <div className="focus-why">
            Tied to roadmap goal <b>auth-success 87% → 92%</b>. Estimated impact{' '}
            <span className="blue">+8%</span>. Continues yesterday's open thread.
          </div>
        )}
      </div>
    </div>
  )
}
