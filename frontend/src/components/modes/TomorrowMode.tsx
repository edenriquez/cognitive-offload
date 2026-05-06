import { useAppStore } from '../../store/app-store'

export default function TomorrowMode() {
  const setMode = useAppStore(s => s.setMode)

  return (
    <div className="tomorrow">
      <div className="tomorrow-inner">
        <div className="tom-h">Wed · May 6 · auto-generated</div>
        <h1 className="tom-headline">Recovery day. One thread, one cutoff, no fatigue work.</h1>
        <div className="tom-list">
          <div className="tom-item">
            <span className="tom-rank locked">01 ◆</span>
            <div>
              <div className="tom-task">Close out retry-logic v2 — checkpoint, ship behind flag, or archive.</div>
              <div className="tom-meta">continues yesterday's open thread · 90m · <b>auth-success +8%</b> projected</div>
            </div>
          </div>
          <div className="tom-item">
            <span className="tom-rank">02</span>
            <div>
              <div className="tom-task">Tune p99 latency alerts — drop noise from on-call.</div>
              <div className="tom-meta">60m · alerts/wk 21 → 12 target · <b>−4 alerts</b> projected</div>
            </div>
          </div>
          <div className="tom-item">
            <span className="tom-rank">03</span>
            <div>
              <div className="tom-task">Outline chapter 3 of side-project.</div>
              <div className="tom-meta">protected window · 45m · before 13:00</div>
            </div>
          </div>
        </div>
        <div className="tom-cta">
          <button className="btn-secondary">Adjust</button>
          <button className="btn-primary" onClick={() => setMode('today')}>Lock in plan</button>
        </div>
      </div>
    </div>
  )
}
