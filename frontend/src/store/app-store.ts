import { create } from 'zustand'
import type { Mode, Task, Bandwidth, SignalSnapshot, Capture } from '../types'

interface AppState {
  mode: Mode
  setMode: (m: Mode) => void

  activeFocusTask: string | null
  startFocus: (task: string) => void
  exitFocus: () => void

  tasks: Task[]
  setTasks: (tasks: Task[]) => void
  toggleTask: (id: string) => void

  bandwidth: Bandwidth
  setBandwidth: (bw: Bandwidth) => void

  captures: Capture[]
  setCaptures: (caps: Capture[]) => void
  addCapture: (cap: Capture) => void

  signals: SignalSnapshot | null
  setSignals: (s: SignalSnapshot) => void

  toast: { msg: string; action: string } | null
  setToast: (t: { msg: string; action: string } | null) => void

  now: Date
  setNow: (d: Date) => void
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'today',
  setMode: (m) => set({ mode: m }),

  activeFocusTask: null,
  startFocus: (task) => set({ activeFocusTask: task, mode: 'focus' }),
  exitFocus: () => set({ activeFocusTask: null, mode: 'today' }),

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
  setSignals: (s) => set({ signals: s }),

  toast: null,
  setToast: (t) => set({ toast: t }),

  now: new Date(),
  setNow: (d) => set({ now: d }),
}))
