import { create } from "zustand";
import type { Mode, Task, Bandwidth, SignalSnapshot, Capture } from "../types";

// ── Parallel focus sessions ───────────────────────────────────────────────────

export interface ParallelSession {
  taskId: string;
  taskText: string;
  remainingSecs: number;
  durationSecs: number;
  isPaused: boolean;
}

// ── Legacy single-focus shim (kept for toast/pendingAction compatibility) ─────

export interface FocusState {
  task: string | null; // text of the first running session, or null
  remainingSecs: number;
  totalSecs: number; // original duration of the current session
  isPaused: boolean;
  sessionId: string | null;
}

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;

  // ── Parallel focus sessions ─────────────────────────────────────────────────
  activeSessions: ParallelSession[];
  startSession: (
    taskId: string,
    taskText: string,
    durationSecs: number,
  ) => void;
  pauseSession: (taskId: string) => void;
  resumeSession: (taskId: string) => void;
  stopSession: (taskId: string) => void;
  tickSessions: () => void;

  // Shim so existing callers (toast, App.tsx timer guard) still work
  focus: FocusState;

  // Legacy kept for pendingAction (TodayMode) compat
  startFocus: (task: string, durationSecs?: number) => void;
  setFocusDuration: (secs: number) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  exitFocus: (outcome: "done" | "paused") => void;
  tickFocus: () => void;

  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  toggleTask: (id: string) => void;

  bandwidth: Bandwidth;
  setBandwidth: (bw: Bandwidth) => void;

  captures: Capture[];
  setCaptures: (caps: Capture[]) => void;
  addCapture: (cap: Capture) => void;

  signals: SignalSnapshot | null;
  setSignals: (s: SignalSnapshot) => void;

  toast: {
    msg: string;
    action: string;
    actionKind?: string;
    action2?: string;
    action2Kind?: string;
    rule?: string;
  } | null;
  setToast: (
    t: {
      msg: string;
      action: string;
      actionKind?: string;
      action2?: string;
      action2Kind?: string;
      rule?: string;
    } | null,
  ) => void;
  dismissedRules: Set<string>;
  dismissRule: (rule: string) => void;

  pendingAction: { kind: string; taskText?: string } | null;
  setPendingAction: (a: { kind: string; taskText?: string } | null) => void;

  emailMatches: import("../types").EmailMatch[];
  addEmailMatch: (m: import("../types").EmailMatch) => void;
  clearEmailMatches: () => void;

  now: Date;
  setNow: (d: Date) => void;

  selfReportOpen: boolean;
  setSelfReportOpen: (open: boolean) => void;
  lastSelfReport: { level: number; label: string; ts: number } | null;
  setLastSelfReport: (
    r: { level: number; label: string; ts: number } | null,
  ) => void;
}

// Build the FocusState shim from the activeSessions array
function shimFocus(sessions: ParallelSession[]): FocusState {
  const first = sessions.find((s) => !s.isPaused) ?? sessions[0] ?? null;
  if (!first) {
    return {
      task: null,
      remainingSecs: 90 * 60,
      totalSecs: 90 * 60,
      isPaused: false,
      sessionId: null,
    };
  }
  return {
    task: first.taskText,
    remainingSecs: first.remainingSecs,
    totalSecs: first.durationSecs,
    isPaused: first.isPaused,
    sessionId: null,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: "today",
  setMode: (m) => set({ mode: m }),

  // ── Parallel sessions ────────────────────────────────────────────────────────

  activeSessions: [],

  startSession: (taskId, taskText, durationSecs) => {
    set((s) => {
      const existing = s.activeSessions.find((x) => x.taskId === taskId);
      let next: ParallelSession[];
      if (existing) {
        // Resume if paused, or reset if same task
        next = s.activeSessions.map((x) =>
          x.taskId === taskId ? { ...x, isPaused: false } : x,
        );
      } else {
        next = [
          ...s.activeSessions,
          {
            taskId,
            taskText,
            remainingSecs: durationSecs,
            durationSecs,
            isPaused: false,
          },
        ];
      }
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },

  pauseSession: (taskId) => {
    set((s) => {
      const next = s.activeSessions.map((x) =>
        x.taskId === taskId ? { ...x, isPaused: true } : x,
      );
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },

  resumeSession: (taskId) => {
    set((s) => {
      const next = s.activeSessions.map((x) =>
        x.taskId === taskId ? { ...x, isPaused: false } : x,
      );
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },

  stopSession: (taskId) => {
    set((s) => {
      const next = s.activeSessions.filter((x) => x.taskId !== taskId);
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },

  tickSessions: () => {
    set((s) => {
      const next = s.activeSessions.map((x) =>
        x.isPaused || x.remainingSecs <= 0
          ? x
          : { ...x, remainingSecs: x.remainingSecs - 1 },
      );
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },

  // Shim: derived from activeSessions, kept in sync by every mutation above
  focus: shimFocus([]),

  // Legacy focus actions (used by TodayMode pendingAction, toast handlers)
  startFocus: (task, durationSecs) => {
    const dur = durationSecs ?? 90 * 60;
    set((s) => {
      const existing = s.activeSessions.find((x) => x.taskText === task);
      let next: ParallelSession[];
      if (existing) {
        next = s.activeSessions.map((x) =>
          x.taskText === task ? { ...x, isPaused: false } : x,
        );
      } else {
        next = [
          ...s.activeSessions,
          {
            taskId: `legacy-${Date.now()}`,
            taskText: task,
            remainingSecs: dur,
            durationSecs: dur,
            isPaused: false,
          },
        ];
      }
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },
  setFocusDuration: (secs) =>
    set((s) => {
      const next = s.activeSessions.map((x, i) =>
        i === 0 ? { ...x, remainingSecs: secs } : x,
      );
      return { activeSessions: next, focus: shimFocus(next) };
    }),
  pauseFocus: () => {
    set((s) => {
      const first = s.activeSessions[0];
      if (!first) return s;
      const next = s.activeSessions.map((x, i) =>
        i === 0 ? { ...x, isPaused: true } : x,
      );
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },
  resumeFocus: () => {
    set((s) => {
      const first = s.activeSessions[0];
      if (!first) return s;
      const next = s.activeSessions.map((x, i) =>
        i === 0 ? { ...x, isPaused: false } : x,
      );
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },
  exitFocus: () => {
    set((s) => {
      const next = s.activeSessions.slice(1);
      return { activeSessions: next, focus: shimFocus(next) };
    });
  },
  tickFocus: () => {
    // Delegates to tickSessions for backward compat (App.tsx still calls this)
    get().tickSessions();
  },

  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  toggleTask: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    })),

  bandwidth: { work: 60, personal: 15, admin: 15, learning: 10 },
  setBandwidth: (bw) => set({ bandwidth: bw }),

  captures: [],
  setCaptures: (caps) => set({ captures: caps }),
  addCapture: (cap) => set((s) => ({ captures: [cap, ...s.captures] })),

  signals: null,
  setSignals: (s) =>
    set((state) => {
      const prev = state.signals;
      if (
        prev &&
        prev.focus_state === s.focus_state &&
        prev.active_threads === s.active_threads &&
        prev.error_rate === s.error_rate &&
        prev.open_loops === s.open_loops &&
        prev.cognitive_threshold_pct === s.cognitive_threshold_pct &&
        (prev.interventions?.length ?? 0) === (s.interventions?.length ?? 0)
      ) {
        return state;
      }
      return { signals: s };
    }),

  toast: null,
  setToast: (t) => set({ toast: t }),
  dismissedRules: new Set<string>(),
  dismissRule: (rule) =>
    set((s) => ({ dismissedRules: new Set([...s.dismissedRules, rule]) })),

  pendingAction: null,
  setPendingAction: (a) => set({ pendingAction: a }),

  emailMatches: [],
  addEmailMatch: (m) => set((s) => ({ emailMatches: [...s.emailMatches, m] })),
  clearEmailMatches: () => set({ emailMatches: [] }),

  now: new Date(),
  setNow: (d) => set({ now: d }),

  selfReportOpen: false,
  setSelfReportOpen: (open) => set({ selfReportOpen: open }),
  lastSelfReport: null,
  setLastSelfReport: (r) => set({ lastSelfReport: r }),
}));
