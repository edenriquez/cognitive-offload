// Mock data: 24h log signal stream + sessions + detected patterns
// Hours 0-23. Activity density 0-100, errors per 10min, ai-sessions per 10min.

window.COGLOAD_DATA = (function() {
  // Per-10min buckets across the workday 07:00 → 22:00 (90 buckets)
  const START = 7;
  const buckets = [];
  for (let i = 0; i < 90; i++) {
    const h = START + i / 6;
    let activity, errors, sessions;
    // Morning warmup
    if (h < 8.5) { activity = 25 + Math.random() * 15; errors = 0; sessions = i % 3 === 0 ? 1 : 0; }
    // Strong morning peak 8:30-11:30
    else if (h < 11.5) { activity = 70 + Math.random() * 25; errors = Math.random() < 0.15 ? 1 : 0; sessions = Math.random() < 0.4 ? 1 : 0; }
    // Pre-lunch dip
    else if (h < 12.5) { activity = 45 + Math.random() * 20; errors = Math.random() < 0.2 ? 1 : 0; sessions = Math.random() < 0.5 ? 1 : 0; }
    // Lunch black hole
    else if (h < 13.5) { activity = 5 + Math.random() * 8; errors = 0; sessions = 0; }
    // Post-lunch crash 13:30-14:30
    else if (h < 14.5) { activity = 30 + Math.random() * 15; errors = Math.random() < 0.4 ? 2 : 1; sessions = Math.random() < 0.7 ? 1 : 0; }
    // Thrashing window 14:30-15:30 (the diagnosis)
    else if (h < 15.5) { activity = 55 + Math.random() * 20; errors = Math.random() < 0.5 ? 2 : 1; sessions = Math.random() < 0.85 ? 2 : 1; }
    // Recovery 15:30-16:30
    else if (h < 16.5) { activity = 65 + Math.random() * 15; errors = Math.random() < 0.2 ? 1 : 0; sessions = Math.random() < 0.4 ? 1 : 0; }
    // Past cutoff: fatigue work
    else if (h < 18) { activity = 50 + Math.random() * 15; errors = Math.random() < 0.6 ? 2 : 1; sessions = Math.random() < 0.5 ? 1 : 0; }
    // Evening collapse
    else if (h < 20) { activity = 20 + Math.random() * 15; errors = Math.random() < 0.3 ? 1 : 0; sessions = Math.random() < 0.2 ? 1 : 0; }
    else { activity = 5 + Math.random() * 5; errors = 0; sessions = 0; }
    buckets.push({ h, activity: Math.round(activity), errors, sessions });
  }

  // Sessions list (open loops + closed)
  const sessions = [
    { id: 's1', label: 'auth-success rate routing', start: '08:42', end: '10:18', ai: 14, status: 'closed', errors: 1 },
    { id: 's2', label: 'OTP carrier mapping',        start: '10:25', end: '11:32', ai: 22, status: 'closed', errors: 0 },
    { id: 's3', label: 'retry-logic v2 (flag)',      start: '11:40', end: null,    ai: 9,  status: 'open',   errors: 2 },
    { id: 's4', label: 'post-mortem draft',          start: '13:55', end: null,    ai: 3,  status: 'stalled',errors: 0 },
    { id: 's5', label: 'PR #1284 review',            start: '14:30', end: '14:36', ai: 1,  status: 'closed', errors: 0 },
    { id: 's6', label: 'env: docker-compose up',     start: '14:38', end: '14:41', ai: 1,  status: 'closed', errors: 3 },
    { id: 's7', label: 'PR #1284 review (resumed)',  start: '14:42', end: '14:48', ai: 1,  status: 'closed', errors: 0 },
    { id: 's8', label: 'analytics replica notes',    start: '14:51', end: '14:55', ai: 1,  status: 'closed', errors: 0 },
    { id: 's9', label: 'OTP retries question',       start: '14:58', end: '15:01', ai: 1,  status: 'closed', errors: 1 },
    { id: 's10',label: 'retry-logic v2 (flag)',      start: '15:08', end: null,    ai: 4,  status: 'open',   errors: 1 },
    { id: 's11',label: 'PagerDuty audit',            start: '17:15', end: null,    ai: 2,  status: 'open',   errors: 2 },
  ];

  // Detected patterns (real-time)
  const patterns = [
    { id: 'p1', kind: 'thrashing', severity: 'high',
      title: 'Session thrashing detected',
      detail: '7 single-message sessions in the 14:30–15:00 window. Avg duration 3m. Likely context fragmentation.',
      window: '14:30–15:00', signal: 'session count', evidence: { count: 7, avg: '3m' }, action: 'Block new sessions' },
    { id: 'p2', kind: 'crash', severity: 'medium',
      title: 'Post-lunch crash',
      detail: 'Activity dropped 62% from morning peak between 13:30–14:30. Pattern repeats 4 of last 5 days.',
      window: '13:30–14:30', signal: 'activity density', evidence: { drop: '−62%', streak: '4/5d' }, action: 'Schedule recovery' },
    { id: 'p3', kind: 'stuck', severity: 'medium',
      title: 'Stuck loop · retry-logic v2',
      detail: 'Open 4h 12m with low interaction (9 AI msgs, 1 commit). Same 3 files reopened.',
      window: '11:40–now', signal: 'progress / activity', evidence: { open: '4h 12m', commits: 1 }, action: 'Force checkpoint' },
    { id: 'p4', kind: 'cold-start', severity: 'low',
      title: 'Cold-start inefficiency',
      detail: '3 environment errors in first 4 minutes after lunch break. ~14 min lost across the week.',
      window: '14:38–14:42', signal: 'errors / setup', evidence: { errors: 3, weekLoss: '14m' }, action: 'Add pre-flight' },
    { id: 'p5', kind: 'overwork', severity: 'high',
      title: 'Past cognitive cutoff',
      detail: 'Active work continued past 16:30. Error rate +180% vs morning baseline. Quality collapse risk.',
      window: '17:15–18:30', signal: 'errors + time', evidence: { errRise: '+180%' }, action: 'Stop + log' },
    { id: 'p6', kind: 'open-loops', severity: 'medium',
      title: '3 open threads',
      detail: 'retry-logic v2 · post-mortem draft · PagerDuty audit. None closed or archived.',
      window: 'all day', signal: 'session lifecycle', evidence: { open: 3 }, action: 'Triage threads' },
  ];

  // Energy leaks (audit)
  const leaks = [
    { time: '13:30–14:30', cost: '−1h 04m', cause: 'Post-lunch crash',  fix: 'Move to 11:00 deep block' },
    { time: '14:30–15:00', cost: '−27m',    cause: 'Session thrashing', fix: 'Cap at 1 active thread'   },
    { time: '14:38–14:42', cost: '−4m × 5', cause: 'Cold-start errors', fix: 'Pre-flight checklist'     },
    { time: '17:15–18:30', cost: 'quality', cause: 'Fatigue work',      fix: 'Hard stop at 16:30'       },
  ];

  // Root causes (audit)
  const rootCauses = [
    { signal: '7 sessions / 30m',    cause: 'No active-thread cap → context-switch tax', confidence: 92 },
    { signal: '−62% post-lunch dip', cause: 'Heavy lunch + immediate cognitive load',    confidence: 78 },
    { signal: '+180% error spike',   cause: 'Working past cutoff under fatigue',          confidence: 88 },
    { signal: '3 open threads',      cause: 'No close-or-archive enforcement',           confidence: 85 },
  ];

  return { buckets, sessions, patterns, leaks, rootCauses, START };
})();
