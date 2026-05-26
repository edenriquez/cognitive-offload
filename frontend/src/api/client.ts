import type {
  Task,
  Capture,
  TodayResponse,
  ReviewSummary,
  Plan,
  SignalSnapshot,
  FocusSession,
  Project,
  DailyBudget,
  DailyReport,
  DailySummaryRecord,
  SessionScore,
  BlockConfig,
  DaySchedule,
  DayBlock,
  TaskEdge,
  TaskGraph,
} from "../types";

// In dev mode, Vite proxy forwards /api → 127.0.0.1:9200.
// In production Tauri build, there’s no proxy — hit the backend directly.
const IS_TAURI = Boolean(
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__,
);
const BASE = IS_TAURI ? "http://127.0.0.1:9200" : "";

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const opts: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(`${BASE}${path}`, opts);

      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        if ([502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
          lastError = new Error(`${method} ${path} → ${res.status}: ${text}`);
          continue;
        }
        throw new Error(`${method} ${path} → ${res.status}: ${text}`);
      }
      return res.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`${method} ${path} → timeout after 8s`);
      }
      // Network error (TypeError from fetch) — retry if attempts remain
      if (err instanceof TypeError && attempt < MAX_RETRIES) {
        lastError = err;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`${method} ${path} → failed after retries`);
}

// ---------- Today ----------
export const api = {
  getToday: () => request<TodayResponse>("GET", "/api/v1/today"),

  // ---------- Tasks ----------
  createTask: (kind: string, text: string) =>
    request<Task>("POST", "/api/v1/tasks", { kind, text }),

  updateTask: (id: string, text: string, kind: string, idx: number) =>
    request<{ status: string }>("PUT", `/api/v1/tasks/${id}`, {
      text,
      kind,
      idx,
    }),

  deleteTask: (id: string) =>
    request<{ status: string }>("DELETE", `/api/v1/tasks/${id}`),

  toggleTask: (id: string) =>
    request<{ status: string }>("PATCH", `/api/v1/today/tasks/${id}`),

  reorderTasks: (orders: { id: string; idx: number }[]) =>
    request<{ status: string }>("POST", "/api/v1/tasks/reorder", { orders }),

  // ---------- Focus ----------
  startFocus: (taskId: string) =>
    request<FocusSession>("POST", "/api/v1/focus/start", { task_id: taskId }),

  stopFocus: (outcome: string = "done") =>
    request<{ status: string; outcome: string }>("POST", "/api/v1/focus/stop", {
      outcome,
    }),

  currentFocus: () =>
    request<FocusSession | { active: false }>("GET", "/api/v1/focus/current"),

  focusHistory: (day?: string) =>
    request<FocusSession[]>(
      "GET",
      `/api/v1/focus/history${day ? `?day=${day}` : ""}`,
    ),

  // ---------- Captures ----------
  createCapture: (text: string) =>
    request<Capture>("POST", "/api/v1/captures", { text }),

  listCaptures: () => request<Capture[]>("GET", "/api/v1/captures"),

  deleteCapture: (id: string) =>
    request<{ status: string }>("DELETE", `/api/v1/captures/${id}`),

  promoteCapture: (id: string) =>
    request<Task>("POST", `/api/v1/captures/${id}/promote`),

  // ---------- Review ----------
  getReview: (day: string) =>
    request<ReviewSummary>("GET", `/api/v1/review/${day}`),

  acknowledgePattern: (id: string) =>
    request<{ status: string }>(
      "POST",
      `/api/v1/review/patterns/${id}/acknowledge`,
    ),
  dismissPattern: (id: string) =>
    request<{ status: string }>(
      "POST",
      `/api/v1/review/patterns/${id}/dismiss`,
    ),

  // ---------- Tomorrow ----------
  getTomorrow: () => request<Plan>("GET", "/api/v1/tomorrow"),

  lockTomorrow: () => request<Plan>("POST", "/api/v1/tomorrow/lock"),

  regenerateTomorrow: () =>
    request<Plan>("POST", "/api/v1/tomorrow/regenerate"),

  rolloverTomorrow: () =>
    request<{ status: string; tasks_created: number; day: string }>(
      "POST",
      "/api/v1/tomorrow/rollover",
    ),

  updateTomorrow: (plan: Partial<Plan>) =>
    request<Plan>("PUT", "/api/v1/tomorrow", plan),

  // ---------- Sessions ----------
  closeSession: (id: string) =>
    request<{ status: string }>("POST", `/api/v1/sessions/${id}/close`),

  // ---------- Signals ----------
  currentSignals: () =>
    request<SignalSnapshot>("GET", "/api/v1/signals/current"),

  // ---------- Sources ----------
  getSources: () =>
    request<import("../types").SourceStatus[]>("GET", "/api/v1/sources"),

  // ---------- Config ----------
  getConfig: () =>
    request<{
      cutoff_hour: number;
      lunch_start: number;
      lunch_end: number;
      watch_paths: string[];
      ignore_dirs: string[];
      max_watch_dirs: number;
      disabled_rules: string[];
    }>("GET", "/api/v1/config"),

  updateConfig: (updates: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", "/api/v1/config", updates),

  // ---------- Interventions ----------
  listInterventions: () =>
    request<import("../types").Intervention[]>("GET", "/api/v1/interventions"),

  // ---------- Self Reports ----------
  createSelfReport: (level: number, label: string, note: string = "") =>
    request<{
      status: string;
      level: number;
      label: string;
      bucket_idx: number;
    }>("POST", "/api/v1/self-report", { level, label, note }),

  listSelfReports: (day?: string) =>
    request<import("../types").SelfReport[]>(
      "GET",
      `/api/v1/self-reports${day ? `?day=${day}` : ""}`,
    ),

  // ---------- Projects ----------
  listProjects: () => request<Project[]>("GET", "/api/v1/projects"),

  upsertProject: (project: {
    name: string;
    path: string;
    kind: string;
    color: string;
  }) => request<Project>("POST", "/api/v1/projects", project),

  updateProject: (id: string, updates: Partial<Project>) =>
    request<Project>("PUT", `/api/v1/projects/${id}`, updates),

  deleteProject: (id: string) =>
    request<{ status: string }>("DELETE", `/api/v1/projects/${id}`),

  // ---------- Budget ----------
  getBudget: () => request<DailyBudget>("GET", "/api/v1/budget"),

  updateBudget: (budget: DailyBudget) =>
    request<DailyBudget>("PUT", "/api/v1/budget", budget),

  // ---------- Report ----------
  getReport: (day: string) =>
    request<DailyReport>("GET", `/api/v1/report/${day}`),

  // ---------- Trends ----------
  getTrends: (days: number = 7) =>
    request<DailySummaryRecord[]>("GET", `/api/v1/trends?days=${days}`),

  // ---------- Session Scores ----------
  getSessionScores: (day?: string) =>
    request<SessionScore[]>(
      "GET",
      `/api/v1/sessions/scores${day ? `?day=${day}` : ""}`,
    ),

  // ---------- Calendar Heatmap ----------
  getCalendar: () =>
    request<import("../types").DailySummaryRecord[]>("GET", "/api/v1/calendar"),

  // ---------- LLM Analysis ----------
  analyzeDay: (day: string) =>
    request<{
      source: string;
      headline?: string;
      analysis: { title: string; content: string }[];
      suggestions: { title: string; detail: string; metric: string }[];
      cognitive_score?: number;
      productivity_rating?: string;
    }>("POST", `/api/v1/analyze/${day}`),

  // ---------- Cognitive Budget ----------
  estimateTask: (taskId: string, projectPath?: string) =>
    request<import("../types").TaskEstimate>(
      "POST",
      `/api/v1/tasks/${taskId}/estimate`,
      projectPath ? { project_path: projectPath } : undefined,
    ),

  estimateNewTask: (taskText: string, projectPath?: string) =>
    request<import("../types").TaskEstimate>("POST", "/api/v1/estimate", {
      task_text: taskText,
      project_path: projectPath || "",
    }),

  // ---------- Claude Status ----------
  claudeStatus: () =>
    request<{ online: boolean; masked_key: string }>(
      "GET",
      "/api/v1/claude/status",
    ),

  setClaudeKey: (key: string) =>
    request<{ status: string }>("POST", "/api/v1/claude/key", { key }),

  // ── Task Dependency Map ──────────────────────────────────────────────────
  getTaskGraph: (day?: string) =>
    request<TaskGraph>("GET", `/api/v1/map${day ? `?day=${day}` : ""}`),
  createEdge: (
    sourceId: string,
    targetId: string,
    kind: "blocks" | "subtask",
  ) =>
    request<TaskEdge>("POST", "/api/v1/map/edges", {
      source_id: sourceId,
      target_id: targetId,
      kind,
    }),
  deleteEdge: (id: string) =>
    request<{ status: string }>("DELETE", `/api/v1/map/edges/${id}`),
  getReadyTasks: (day?: string) =>
    request<{ ready: string[] }>(
      "GET",
      `/api/v1/map/ready${day ? `?day=${day}` : ""}`,
    ),

  // ── Task Notes ────────────────────────────────────────────────────────
  getTaskNote: (taskId: string) =>
    request<import("../types").TaskNote>("GET", `/api/v1/tasks/${taskId}/note`),
  upsertTaskNote: (taskId: string, content: string) =>
    request<import("../types").TaskNote>(
      "PUT",
      `/api/v1/tasks/${taskId}/note`,
      { content },
    ),

  // ── Block Budget ────────────────────────────────────────────────────────
  getBlockConfig: () => request<BlockConfig>("GET", "/api/v1/blocks/config"),
  updateBlockConfig: (cfg: BlockConfig) =>
    request<BlockConfig>("PUT", "/api/v1/blocks/config", cfg),
  getBlockSchedule: () => request<DaySchedule>("GET", "/api/v1/blocks/today"),
  generateBlocks: () => request<DaySchedule>("POST", "/api/v1/blocks/generate"),
  startBlock: (id: string) =>
    request<DayBlock>("POST", `/api/v1/blocks/${id}/start`),
  completeBlock: (id: string) =>
    request<DayBlock>("POST", `/api/v1/blocks/${id}/complete`),
  skipBlock: (id: string) =>
    request<DayBlock>("POST", `/api/v1/blocks/${id}/skip`),
};
