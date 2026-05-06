import { useAppStore } from '../../store/app-store'
import EnergyMap from '../shared/EnergyMap'

export default function ReviewMode() {
  const setMode = useAppStore(s => s.setMode)

  return (
    <div className="review">
      <div className="review-inner">
        <h1 className="review-h">Today's review</h1>
        <div className="review-sub">Auto-generated from logs · not self-report</div>

        <div className="review-summary">
          <div className="rs-cell"><div className="rs-v">3h 47m</div><div className="rs-l">Deep work</div></div>
          <div className="rs-cell"><div className="rs-v danger">1h 35m</div><div className="rs-l">Leaked time</div></div>
          <div className="rs-cell"><div className="rs-v">3</div><div className="rs-l">Open loops</div></div>
          <div className="rs-cell"><div className="rs-v">11</div><div className="rs-l">Sessions</div></div>
        </div>

        <div className="section">
          <h2 className="section-h">Energy map</h2>
          <div className="em-card"><EnergyMap /></div>
        </div>

        <div className="section">
          <h2 className="section-h">What pulled you off</h2>
          <div className="patterns">
            <div className="pat">
              <span className="pat-tag high">Thrashing</span>
              <div>
                <div className="pat-title">7 single-message AI sessions in 30 min</div>
                <div className="pat-detail">Likely context fragmentation. Same window 4 of last 5 days.</div>
              </div>
              <span className="pat-window">14:30 — 15:00</span>
            </div>
            <div className="pat">
              <span className="pat-tag">Crash</span>
              <div>
                <div className="pat-title">Activity dropped 62% post-lunch</div>
                <div className="pat-detail">Heavy cognitive load right after meal. Pattern repeats.</div>
              </div>
              <span className="pat-window">13:30 — 14:30</span>
            </div>
            <div className="pat">
              <span className="pat-tag">Stuck</span>
              <div>
                <div className="pat-title">retry-logic v2 — 4h open, 1 commit</div>
                <div className="pat-detail">Same 3 files reopened. Low progress signal. Checkpoint or archive.</div>
              </div>
              <span className="pat-window">11:40 — now</span>
            </div>
            <div className="pat">
              <span className="pat-tag high">Fatigue</span>
              <div>
                <div className="pat-title">Error rate +180% past 16:30 cutoff</div>
                <div className="pat-detail">Quality collapse risk. Hard stop recommended.</div>
              </div>
              <span className="pat-window">17:15 — 18:30</span>
            </div>
          </div>
        </div>

        <div className="section">
          <h2 className="section-h">Where time leaked</h2>
          <div className="leaks">
            <div className="leak">
              <span className="leak-time">13:30 — 14:30</span>
              <span className="leak-cost">−1h 04m</span>
              <span className="leak-cause">Post-lunch crash</span>
              <span className="leak-fix">Move deep block to 11:00 →</span>
            </div>
            <div className="leak">
              <span className="leak-time">14:30 — 15:00</span>
              <span className="leak-cost">−27m</span>
              <span className="leak-cause">Session thrashing</span>
              <span className="leak-fix">Cap at 1 active thread →</span>
            </div>
            <div className="leak">
              <span className="leak-time">14:38 — 14:42</span>
              <span className="leak-cost">−4m × 5</span>
              <span className="leak-cause">Cold-start errors</span>
              <span className="leak-fix">Pre-flight checklist →</span>
            </div>
            <div className="leak">
              <span className="leak-time">17:15 — 18:30</span>
              <span className="leak-cost">quality</span>
              <span className="leak-cause">Fatigue work</span>
              <span className="leak-fix">Hard stop at 16:30 →</span>
            </div>
          </div>
        </div>

        <div className="tom-card">
          <div>
            <div className="tom-eye">Tomorrow's plan is ready</div>
            <div className="tom-line">
              Recovery day. <b>One-thread cap</b>, cutoff at <b>15:00</b>, deep block at <b>09:00–11:00</b>. Your first task is set.
            </div>
          </div>
          <button className="btn-primary" onClick={() => setMode('tomorrow')}>Open plan</button>
        </div>
      </div>
    </div>
  )
}
