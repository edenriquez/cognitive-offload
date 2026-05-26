export type Mode = "today" | "map" | "review" | "sources" | "settings";

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
  acknowledged: boolean;
  dismissed: boolean;
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
  momentum_velocity: number;
  momentum_peak: number;
  wall_detected: boolean;
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

// V2 types

export interface Project {
  id: string;
  name: string;
  path: string;
  kind: "work" | "personal" | "side";
  color: string;
}

export interface BudgetEntry {
  project_id: string;
  pct: number;
}

export interface DailyBudget {
  day: string;
  allocations: BudgetEntry[];
}

export interface SessionScore {
  session_id: string;
  output_score: number;
  file_saves: number;
  commits: number;
  message_count: number;
  duration_min: number;
}

export interface SessionScoreSummary {
  high_leverage: number;
  low_output: number;
  avg_high_score: number;
  avg_low_score: number;
  total_sessions: number;
}

export interface MomentumPoint {
  hour: number;
  cum_messages: number;
  cum_saves: number;
  cum_sessions: number;
  output_per_msg: number;
}

export interface ReportSection {
  title: string;
  content: string;
}

export interface Suggestion {
  priority: number;
  title: string;
  detail: string;
  metric: string;
}

export interface DailyReport {
  day: string;
  sections: ReportSection[];
  suggestions: Suggestion[];
  wall_summary?: string;
}

export interface DailySummaryRecord {
  day: string;
  deep_work_min: number;
  leaked_min: number;
  sessions_count: number;
  avg_session_score: number;
  momentum_peak: number;
  wall_time: string;
  budget_adherence_pct: number;
}

export interface ProjectOutput {
  project_path: string;
  project_name: string;
  kind: string;
  session_count: number;
  total_messages: number;
  file_saves: number;
  git_commits: number;
  active_minutes: number;
  avg_session_score: number;
}

// Cognitive Budget types
export interface ComplexityMatrix {
  scope: number;
  novelty: number;
  dependencies: number;
  ambiguity: number;
  prior_work: number;
  error_risk: number;
  cognitive_switch: number;
}

export interface SuggestedTask {
  text: string;
  kind: string;
  estimated_min: number;
  order: number;
}

export interface TaskEstimate {
  id: string;
  task_id: string;
  task_text: string;
  estimated_min: number;
  complexity: "trivial" | "low" | "medium" | "high" | "extreme";
  cognitive_load: number;
  confidence: number;
  should_split: boolean;
  suggested_splits?: SuggestedTask[];
  reasoning: string;
  matrix: ComplexityMatrix;
  source: "heuristic" | "llm";
  created_at: string;
}

// ── Block Budget System ─────────────────────────────────────────────────────

export interface BlockAllocation {
  category: string; // "work", "side_project", "personal", "learning"
  pct: number; // percentage (all must sum to 100)
  label: string; // user-facing label
  color: string; // hex color
}

export interface NonNegotiable {
  id: string;
  label: string; // e.g. "Lunch", "Standup"
  start_hour: number; // e.g. 12.0
  end_hour: number; // e.g. 13.0
  days: number[]; // 0=Sun..6=Sat, empty = every day
}

export interface BlockConfig {
  block_duration_min: number; // default 90
  workday_start_hour: number; // e.g. 9.0
  workday_end_hour: number; // e.g. 17.0
  allocations: BlockAllocation[];
  non_negotiables: NonNegotiable[];
}

export interface DayBlock {
  id: string;
  day: string;
  idx: number;
  category: string;
  label: string;
  start_minute: number; // minutes from midnight
  end_minute: number;
  status: "planned" | "active" | "completed" | "skipped";
  actual_start: number; // unix timestamp
  actual_end: number;
  notes: string;
}

// ── Task Dependency Graph ───────────────────────────────────────────────────

export interface TaskEdge {
  id: string;
  source_id: string;
  target_id: string;
  kind: "blocks" | "subtask";
  created_at: number;
}

export interface TaskGraph {
  tasks: Task[];
  edges: TaskEdge[];
}

export interface DaySchedule {
  day: string;
  blocks: DayBlock[];
  non_negotiables: NonNegotiable[];
  total_blocks: number;
  completed_blocks: number;
  active_block: DayBlock | null;
  blocks_remaining: number;
  day_complete: boolean;
}
