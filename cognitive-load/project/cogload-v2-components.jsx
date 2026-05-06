// V2 components: LiveSignals, BehavioralWarnings, Insights, Audit, Tomorrow

// ============================================================
// LIVE SIGNALS STRIP — top of Today
// ============================================================
function LiveSignals({ now }) {
  // Mock: derive current state from "now" hour
  const h = 14.6; // pinned demo to thrashing window for visibility
  const sessionsLastHour = 7;
  const errorRate = 4.2;
  const focusState = sessionsLastHour > 5 ? 'thrashing' : sessionsLastHour > 2 ? 'fragmented' : 'stable';
  const stateColor = focusState === 'thrashing' ? 'var(--warn)' : focusState === 'fragmented' ? 'var(--accent)' : 'var(--ok)';
  return (
    <div className="live-strip">
      <div className="live-cell">
        <div className="live-h">FOCUS STATE</div>
        <div className="live-v" style={{color:stateColor}}>
          <span className="live-dot" style={{background:stateColor}}></span>
          {focusState.toUpperCase()}
        </div>
        <div className="live-sub">last 30m · session pattern</div>
      </div>
      <div className="live-cell">
        <div className="live-h">SESSIONS · 1H</div>
        <div className="live-v" style={{color: sessionsLastHour > 5 ? 'var(--warn)' : 'var(--ink-0)'}}>
          {sessionsLastHour}<span style={{color:'var(--ink-3)',fontSize:13}}> / 4 cap</span>
        </div>
        <div className="live-sparkline">
          {[1,2,1,3,2,5,7].map((v,i) => (
            <span key={i} style={{height: `${v*8}px`, background: i>4?'var(--warn)':'var(--ink-3)'}}></span>
          ))}
        </div>
      </div>
      <div className="live-cell">
        <div className="live-h">ERROR RATE</div>
        <div className="live-v" style={{color:'var(--warn)'}}>
          {errorRate}<span style={{color:'var(--ink-3)',fontSize:13}}>/10m</span>
          <span className="live-trend">▲ 180%</span>
        </div>
        <div className="live-sub">vs morning baseline (1.5)</div>
      </div>
      <div className="live-cell">
        <div className="live-h">OPEN THREADS</div>
        <div className="live-v">3<span style={{color:'var(--ink-3)',fontSize:13}}> / 1 cap</span></div>
        <div className="live-sub" style={{color:'var(--warn)'}}>over cap · close before new</div>
      </div>
      <div className="live-cell">
        <div className="live-h">COG. THRESHOLD</div>
        <div className="live-v">87%<span style={{color:'var(--ink-3)',fontSize:13}}> used</span></div>
        <div className="live-bar"><span style={{width:'87%', background:'var(--warn)'}}></span></div>
      </div>
    </div>
  );
}

// ============================================================
// BEHAVIORAL WARNINGS — real-time interventions
// ============================================================
function BehavioralWarnings({ patterns, onDismiss }) {
  const high = patterns.filter(p => p.severity === 'high');
  const others = patterns.filter(p => p.severity !== 'high');
  return (
    <div className="warnings">
      {high.map(p => (
        <div key={p.id} className="warn-card high">
          <div className="warn-rail"></div>
          <div className="warn-icon">!</div>
          <div className="warn-body">
            <div className="warn-title">{p.title}</div>
            <div className="warn-detail">{p.detail}</div>
            <div className="warn-evidence">
              {Object.entries(p.evidence).map(([k,v]) => (
                <span key={k} className="evbadge"><b>{v}</b> {k}</span>
              ))}
              <span className="evbadge ghost">window · {p.window}</span>
            </div>
          </div>
          <div className="warn-actions">
            <button className="btn">Snooze 15m</button>
            <button className="btn btn-primary">{p.action}</button>
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <div className="warn-list">
          {others.map(p => (
            <div key={p.id} className={`warn-row ${p.severity}`}>
              <span className="warn-pill">{p.kind}</span>
              <span className="warn-row-title">{p.title}</span>
              <span className="warn-row-detail">{p.detail}</span>
              <button className="warn-row-action">{p.action} →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// INSIGHTS VIEW — observability
// ============================================================
function EnergyMap({ buckets }) {
  const max = Math.max(...buckets.map(b => b.activity));
  const w = 100 / buckets.length;
  return (
    <div className="energy-map">
      <div className="energy-map-y">
        <span>100</span><span>50</span><span>0</span>
      </div>
      <div className="energy-map-area">
        {/* horizontal grid */}
        <div className="grid-line" style={{top:'0%'}}></div>
        <div className="grid-line" style={{top:'50%'}}></div>
        <div className="grid-line" style={{top:'100%'}}></div>

        {/* annotation regions */}
        <div className="region" style={{left:`${(13-7)/15*100}%`,width:`${1/15*100}%`,background:'oklch(0.72 0.09 235 / 0.08)'}}>
          <span className="region-label">lunch · black hole</span>
        </div>
        <div className="region" style={{left:`${(13.5-7)/15*100}%`,width:`${1/15*100}%`,background:'oklch(0.68 0.17 28 / 0.08)'}}>
          <span className="region-label">post-lunch crash</span>
        </div>
        <div className="region" style={{left:`${(14.5-7)/15*100}%`,width:`${1/15*100}%`,background:'oklch(0.68 0.17 28 / 0.14)'}}>
          <span className="region-label" style={{color:'var(--warn)'}}>thrashing</span>
        </div>
        <div className="region" style={{left:`${(16.5-7)/15*100}%`,width:`${1.5/15*100}%`,background:'oklch(0.68 0.17 28 / 0.08)'}}>
          <span className="region-label">past cutoff · fatigue</span>
        </div>

        {/* activity bars */}
        {buckets.map((b, i) => (
          <span key={i} className="ebar" style={{
            left: `${i*w}%`,
            width: `${w*0.85}%`,
            height: `${(b.activity/100)*100}%`,
            background: b.errors >= 2 ? 'var(--warn)' : b.activity > 60 ? 'var(--accent)' : 'var(--ink-3)'
          }}></span>
        ))}

        {/* error markers */}
        {buckets.map((b, i) => b.errors > 0 && (
          <span key={`e${i}`} className="emark" style={{left:`${i*w + w/2}%`, opacity: Math.min(1, b.errors/3)}}></span>
        ))}

        {/* session dots */}
        {buckets.map((b, i) => b.sessions > 0 && (
          <span key={`s${i}`} className="sdot" style={{left:`${i*w + w/2}%`, opacity: Math.min(1, b.sessions/2)}}></span>
        ))}

        {/* now line */}
        <span className="now-line" style={{left:`${(14.6-7)/15*100}%`}}></span>
      </div>
      <div className="energy-map-x">
        {[7,9,11,13,15,17,19,21].map(h => (
          <span key={h} style={{left:`${(h-7)/15*100}%`}}>{h.toString().padStart(2,'0')}:00</span>
        ))}
      </div>
    </div>
  );
}

function InsightsView({ data }) {
  return (
    <div className="view active">
      <div className="section-head">
        <h2>Energy map · today</h2>
        <span className="rule"></span>
        <span className="meta">activity density · errors · AI sessions · auto-generated from logs</span>
      </div>

      <div className="insight-card">
        <EnergyMap buckets={data.buckets} />
        <div className="legend">
          <span><i style={{background:'var(--accent)'}}></i> peak activity</span>
          <span><i style={{background:'var(--ink-3)'}}></i> low activity</span>
          <span><i style={{background:'var(--warn)'}}></i> error-laden</span>
          <span><i className="ldot"></i> AI session</span>
          <span><i className="lmark"></i> error event</span>
        </div>
      </div>

      <div className="section-head">
        <h2>Detected patterns</h2>
        <span className="rule"></span>
        <span className="meta">{data.patterns.length} patterns · ranked by impact</span>
      </div>

      <div className="patterns-grid">
        {data.patterns.map(p => (
          <div key={p.id} className={`pattern ${p.severity}`}>
            <div className="pattern-h">
              <span className="pattern-kind">{p.kind}</span>
              <span className="pattern-sev">{p.severity}</span>
            </div>
            <div className="pattern-title">{p.title}</div>
            <div className="pattern-detail">{p.detail}</div>
            <div className="pattern-foot">
              <span className="pattern-signal">signal · {p.signal}</span>
              <span className="pattern-window">{p.window}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>Session log</h2>
        <span className="rule"></span>
        <span className="meta">{data.sessions.length} sessions · {data.sessions.filter(s=>s.status!=='closed').length} open / stalled</span>
      </div>

      <div className="session-table">
        <div className="session-head">
          <span>id</span><span>thread</span><span>start</span><span>end</span><span>AI msgs</span><span>errs</span><span>status</span>
        </div>
        {data.sessions.map(s => (
          <div key={s.id} className={`session-row ${s.status}`}>
            <span className="mono">{s.id}</span>
            <span>{s.label}</span>
            <span className="mono">{s.start}</span>
            <span className="mono">{s.end || '—'}</span>
            <span className="mono">{s.ai}</span>
            <span className="mono" style={{color: s.errors>=2?'var(--warn)':'var(--ink-2)'}}>{s.errors}</span>
            <span className={`status-pill ${s.status}`}>{s.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// AUDIT VIEW — end of day
// ============================================================
function AuditView({ data }) {
  return (
    <div className="view active">
      <div className="section-head">
        <h2>Daily audit · auto-generated</h2>
        <span className="rule"></span>
        <span className="meta">reality &gt; intention · derived from logs, not self-report</span>
      </div>

      <div className="audit-summary">
        <div className="audit-num">
          <div className="audit-num-v">3h 47m</div>
          <div className="audit-num-l">deep work</div>
        </div>
        <div className="audit-num">
          <div className="audit-num-v" style={{color:'var(--warn)'}}>1h 35m</div>
          <div className="audit-num-l">leaked time</div>
        </div>
        <div className="audit-num">
          <div className="audit-num-v">3</div>
          <div className="audit-num-l">open loops</div>
        </div>
        <div className="audit-num">
          <div className="audit-num-v">11</div>
          <div className="audit-num-l">sessions started</div>
        </div>
        <div className="audit-num">
          <div className="audit-num-v" style={{color:'var(--warn)'}}>−27%</div>
          <div className="audit-num-l">vs 7d avg</div>
        </div>
      </div>

      <div className="section-head"><h2>Energy map</h2><span className="rule"></span></div>
      <div className="insight-card"><EnergyMap buckets={data.buckets} /></div>

      <div className="audit-grid">
        <div>
          <div className="section-head"><h2>Energy leaks</h2><span className="rule"></span></div>
          <div className="leak-list">
            {data.leaks.map((l, i) => (
              <div key={i} className="leak">
                <span className="leak-time">{l.time}</span>
                <span className="leak-cost">{l.cost}</span>
                <span className="leak-cause">{l.cause}</span>
                <span className="leak-fix">→ {l.fix}</span>
              </div>
            ))}
          </div>

          <div className="section-head" style={{marginTop:24}}><h2>Open loops</h2><span className="rule"></span></div>
          <div className="loop-list">
            {data.sessions.filter(s => s.status !== 'closed').map(s => (
              <div key={s.id} className="loop">
                <span className={`status-pill ${s.status}`}>{s.status}</span>
                <span className="loop-label">{s.label}</span>
                <span className="loop-meta">started {s.start} · {s.ai} AI msgs</span>
                <button className="btn">Close · archive</button>
                <button className="btn">Continue tmrw</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="section-head"><h2>Root causes</h2><span className="rule"></span></div>
          <div className="root-list">
            {data.rootCauses.map((r, i) => (
              <div key={i} className="root">
                <div className="root-signal">SIGNAL · {r.signal}</div>
                <div className="root-cause">{r.cause}</div>
                <div className="root-conf">
                  <div className="root-conf-bar"><span style={{width:`${r.confidence}%`}}></span></div>
                  <span>{r.confidence}% confidence</span>
                </div>
              </div>
            ))}
          </div>

          <div className="section-head" style={{marginTop:24}}><h2>Corrections · applied to tomorrow</h2><span className="rule"></span></div>
          <div className="correction-list">
            <div className="correction"><span className="cb">✓</span><span>Hard stop at 16:30 — no MUST WIN past cutoff</span></div>
            <div className="correction"><span className="cb">✓</span><span>Cap active threads at 1 — close-or-archive enforcement on</span></div>
            <div className="correction"><span className="cb">✓</span><span>Move deep block to 09:00–11:00 (peak window)</span></div>
            <div className="correction"><span className="cb">✓</span><span>Pre-flight checklist before post-lunch session</span></div>
            <div className="correction"><span className="cb">✓</span><span>Light task after lunch — recovery, not load</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TOMORROW VIEW — auto-generated plan
// ============================================================
function TomorrowView({ data }) {
  return (
    <div className="view active">
      <div className="tomorrow-banner">
        <div>
          <div className="tomorrow-eyebrow">TOMORROW · WED MAY 6 · auto-generated from yesterday's audit</div>
          <div className="tomorrow-headline">Recovery day. One thread, one cutoff, no fatigue work.</div>
        </div>
        <div className="row" style={{gap:8}}>
          <button className="btn">Reject plan</button>
          <button className="btn btn-primary">Lock in</button>
        </div>
      </div>

      <div className="section-head">
        <h2>Constraints · enforced</h2>
        <span className="rule"></span>
        <span className="meta">derived from detected patterns · cannot be overridden in-day</span>
      </div>

      <div className="constraint-list">
        <div className="constraint"><span className="cb cb-lock">⌷</span>
          <div><b>No work after 15:00.</b><span> · cutoff pulled forward 90m due to fatigue-pattern repeat (4/5 days)</span></div>
        </div>
        <div className="constraint"><span className="cb cb-lock">⌷</span>
          <div><b>1 active thread cap.</b><span> · enforced at editor + AI layer · new sessions blocked until close-or-archive</span></div>
        </div>
        <div className="constraint"><span className="cb cb-lock">⌷</span>
          <div><b>Continue session s10 first.</b><span> · retry-logic v2 — open 4h with stalled progress · checkpoint or archive by 09:30</span></div>
        </div>
        <div className="constraint"><span className="cb cb-lock">⌷</span>
          <div><b>Pre-flight before 13:30 session.</b><span> · 3 cold-start errors yesterday · run `make verify` first</span></div>
        </div>
        <div className="constraint"><span className="cb cb-lock">⌷</span>
          <div><b>Recovery block 13:00–14:00.</b><span> · scheduled, not optional · post-lunch crash mitigation</span></div>
        </div>
      </div>

      <div className="section-head">
        <h2>Adjusted bandwidth</h2>
        <span className="rule"></span>
        <span className="meta">shifted from yesterday's actual, not yesterday's plan</span>
      </div>

      <div className="adjust-grid">
        <div className="adjust-row">
          <span className="adjust-cat">Work Core</span>
          <span className="adjust-from">60% → 50%</span>
          <div className="adjust-bar"><span style={{width:'50%', background:'var(--accent)'}}></span></div>
          <span className="adjust-hrs mono">3.0h</span>
          <span className="adjust-reason">overflow yesterday · 69% actual</span>
        </div>
        <div className="adjust-row">
          <span className="adjust-cat">Personal</span>
          <span className="adjust-from">5% → 20%</span>
          <div className="adjust-bar"><span style={{width:'20%', background:'oklch(0.72 0.11 305)'}}></span></div>
          <span className="adjust-hrs mono">1.2h</span>
          <span className="adjust-reason">below 10% floor 3 days · forced</span>
        </div>
        <div className="adjust-row">
          <span className="adjust-cat">Admin</span>
          <span className="adjust-from">20% → 20%</span>
          <div className="adjust-bar"><span style={{width:'20%', background:'oklch(0.72 0.09 235)'}}></span></div>
          <span className="adjust-hrs mono">1.2h</span>
          <span className="adjust-reason">held — hit plan exactly</span>
        </div>
        <div className="adjust-row">
          <span className="adjust-cat">Learning</span>
          <span className="adjust-from">15% → 10%</span>
          <div className="adjust-bar"><span style={{width:'10%', background:'oklch(0.74 0.12 162)'}}></span></div>
          <span className="adjust-hrs mono">0.6h</span>
          <span className="adjust-reason">underused yesterday · 8% actual</span>
        </div>
      </div>

      <div className="section-head">
        <h2>MUST WIN · pre-selected</h2>
        <span className="rule"></span>
        <span className="meta">pulled from roadmap by impact / open-loop weight</span>
      </div>

      <div className="prefilled">
        <div className="prefill-task locked">
          <span className="rank">01</span>
          <div>
            <div className="prefill-title">Close out retry-logic v2 — checkpoint, ship behind flag, or archive</div>
            <div className="prefill-meta">continues session s10 · est 90m · tied to <b>auth-success 87% → 92%</b> · +8% projected</div>
          </div>
          <span className="prefill-badge">locked · open loop</span>
        </div>
        <div className="prefill-task">
          <span className="rank">02</span>
          <div>
            <div className="prefill-title">Tune p99 latency alerts — drop noise from on-call</div>
            <div className="prefill-meta">est 60m · tied to <b>alerts/wk 21 → 12</b> · −4 alerts projected</div>
          </div>
          <span className="prefill-badge">roadmap match</span>
        </div>
        <div className="prefill-task">
          <span className="rank">03 · personal</span>
          <div>
            <div className="prefill-title">Outline chapter 3 of side-project (45 min, before 13:00)</div>
            <div className="prefill-meta">enforced by 10% personal floor · scheduled in protected window</div>
          </div>
          <span className="prefill-badge violet">protected</span>
        </div>
      </div>

      <div className="section-head">
        <h2>Highest-impact action right now</h2>
        <span className="rule"></span>
      </div>
      <div className="impact-card">
        <div className="impact-q">"What is the highest-impact action <b>right now</b> given my current cognitive state?"</div>
        <div className="impact-a">
          You are at <b>87% cognitive threshold</b> with <b>3 open threads</b> and an active <b>thrashing</b> pattern.
          Highest-impact move is <b>not</b> to start MUST #1 — it's to <b>close-or-archive your 3 open threads</b>,
          take a 10-minute reset, then resume retry-logic v2 with full context.
        </div>
        <div className="row" style={{gap:8, marginTop:14}}>
          <button className="btn">Override</button>
          <button className="btn btn-primary">Triage threads now</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LiveSignals, BehavioralWarnings, InsightsView, AuditView, TomorrowView });
