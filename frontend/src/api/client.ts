import type {
  Task,
  Capture,
  TodayResponse,
  ReviewSummary,
  Plan,
  Session,
  SignalSnapshot,
  FocusSession,
} from "../types";

const BASE = ""; // Vite proxy handles /api → backend

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
      throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`${method} ${path} → timeout after 8s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
  listSessions: (day?: string) =>
    request<Session[]>("GET", `/api/v1/sessions${day ? `?day=${day}` : ""}`),

  createSession: (label: string) =>
    request<Session>("POST", "/api/v1/sessions", { label }),

  closeSession: (id: string) =>
    request<{ status: string }>("POST", `/api/v1/sessions/${id}/close`),

  updateSession: (id: string, label: string, status: string) =>
    request<{ status: string }>("PUT", `/api/v1/sessions/${id}`, {
      label,
      status,
    }),

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
      thread_cap: number;
    }>("GET", "/api/v1/config"),

  updateConfig: (updates: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", "/api/v1/config", updates),

  // ---------- Interventions ----------
  listInterventions: () =>
    request<import("../types").Intervention[]>("GET", "/api/v1/interventions"),
};
