export type Mode =
  | "focus"
  | "today"
  | "capture"
  | "review"
  | "tomorrow"
  | "sources"
  | "settings";

export interface Task {
  id: string;
  day: string;
  kind: "must" | "personal" | "small";
  idx: number;
  text: string;
  done: boolean;
}

export interface Bandwidth {
  work: number;
  personal: number;
  admin: number;
  learning: number;
}

export interface SessionBrief {
  id: string;
  label: string;
  duration_min: number;
  last_touch_ago_sec: number;
}

export interface Session {
  id: string;
  label: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  error_count: number;
  status: "open" | "closed" | "stalled" | "orphan";
  day: string;
}

export interface Bucket {
  day: string;
  bucket_idx: number;
  hour: number;
  activity: number;
  errors: number;
  sessions: number;
  file_saves: number;
  idle_sec: number;
}

export interface Pattern {
  id: string;
  day: string;
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  window: string;
  evidence: Record<string, unknown>;
  detected_at: string;
}

export interface Leak {
  time: string;
  cost: string;
  cause: string;
  fix: string;
}

export interface RootCause {
  signal: string;
  cause: string;
  confidence: number;
}

export interface Intervention {
  id: string;
  severity: "block" | "warn" | "info";
  rule: string;
  title: string;
  body: string;
  evidence: string[];
  action: { label: string; kind: string };
  action2?: { label: string; kind: string };
}

export interface SignalSnapshot {
  focus_state: "degraded" | "fragmented" | "stable";
  active_threads: number;
  error_rate: number;
  error_baseline: number;
  open_loops: number;
  cutoff_hour: number;
  cognitive_threshold_pct: number;
  interventions: Intervention[];
  active_session?: SessionBrief;
}

export interface Constraint {
  rule: string;
  title: string;
  description: string;
  locked: boolean;
}

export interface Plan {
  day: string;
  status: "draft" | "locked" | "completed";
  headline: string;
  constraints: Constraint[];
  bandwidth: Bandwidth;
  tasks: Task[];
  generated_at?: string;
  locked_at?: string;
}

export interface ReviewSummary {
  summary: {
    deep_work_min: number;
    leaked_min: number;
    open_loops: number;
    sessions_count: number;
  };
  energy_map: Bucket[];
  patterns: Pattern[];
  leaks: Leak[];
  root_causes: RootCause[];
  sessions: Session[];
  self_reports: SelfReport[];
}

export interface Capture {
  id: string;
  text: string;
  created_at: string;
}

export interface SelfReport {
  id: number;
  day: string;
  level: number; // 1-5: fresh, focused, loaded, tired, degraded
  label: string;
  ts: number; // Unix ms
  bucket_idx: number;
  note: string;
}

export interface TodayResponse {
  tasks: Task[];
  bandwidth: Bandwidth;
  active_thread?: SessionBrief;
  greet: string;
  completed: number;
  total: number;
}

export interface FocusSession {
  id: string;
  task_id: string;
  task_text: string;
  started_at: string;
  ended_at?: string;
  duration_sec: number;
  outcome: string;
}

export interface SourceStatus {
  name: string;
  type: string;
  status: "active" | "inactive" | "error" | "not_found";
  detail: string;
  events_today: number;
}
