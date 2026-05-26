import { create } from "zustand";
import type { Mode, Task, Bandwidth, SignalSnapshot, Capture } from "../types";

interface FocusState {
  task: string | null;
  remainingSecs: number;
  isPaused: boolean;
  sessionId: string | null;
}

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;

  // Focus
  focus: FocusState;
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

  // Pending cross-mode action triggered from toast
  pendingAction: { kind: string; taskText?: string } | null;
  setPendingAction: (a: { kind: string; taskText?: string } | null) => void;

  now: Date;
  setNow: (d: Date) => void;

  selfReportOpen: boolean;
  setSelfReportOpen: (open: boolean) => void;
  lastSelfReport: { level: number; label: string; ts: number } | null;
  setLastSelfReport: (
    r: { level: number; label: string; ts: number } | null,
  ) => void;
}

const FOCUS_BLOCK_SECS = 90 * 60; // 90 minutes

export const useAppStore = create<AppState>((set, get) => ({
  mode: "today",
  setMode: (m) => set({ mode: m }),

  focus: {
    task: null,
    remainingSecs: FOCUS_BLOCK_SECS,
    isPaused: false,
    sessionId: null,
  },
  startFocus: (task, durationSecs) => {
    const current = get().focus;
    const dur = durationSecs ?? FOCUS_BLOCK_SECS;
    if (
      current.task === task &&
      current.remainingSecs > 0 &&
      current.remainingSecs < dur
    ) {
      set({ focus: { ...current, isPaused: false } });
    } else {
      set({
        focus: {
          task,
          remainingSecs: dur,
          isPaused: false,
          sessionId: null,
        },
      });
    }
  },
  setFocusDuration: (secs) =>
    set((s) => ({ focus: { ...s.focus, remainingSecs: secs } })),
  pauseFocus: () => {
    set((s) => ({ focus: { ...s.focus, isPaused: true } }));
  },
  resumeFocus: () => {
    const f = get().focus;
    if (f.task && f.remainingSecs > 0) {
      set({ focus: { ...f, isPaused: false } });
    }
  },
  exitFocus: (outcome) => {
    if (outcome === "done") {
      // Reset fully
      set({
        focus: {
          task: null,
          remainingSecs: FOCUS_BLOCK_SECS,
          isPaused: false,
          sessionId: null,
        },
        mode: "today",
      });
    } else {
      // Paused — keep timer state
      set((s) => ({
        focus: { ...s.focus, isPaused: true },
        mode: "today",
      }));
    }
  },
  tickFocus: () => {
    set((s) => {
      if (s.focus.isPaused || !s.focus.task || s.focus.remainingSecs <= 0) {
        return s;
      }
      return {
        focus: { ...s.focus, remainingSecs: s.focus.remainingSecs - 1 },
      };
    });
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

  now: new Date(),
  setNow: (d) => set({ now: d }),

  selfReportOpen: false,
  setSelfReportOpen: (open) => set({ selfReportOpen: open }),
  lastSelfReport: null,
  setLastSelfReport: (r) => set({ lastSelfReport: r }),
}));
