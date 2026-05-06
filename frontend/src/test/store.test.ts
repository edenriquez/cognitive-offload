import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../store/app-store";

beforeEach(() => {
  useAppStore.setState({
    mode: "today",
    tasks: [],
    captures: [],
    signals: null,
    toast: null,
    focus: {
      task: null,
      remainingSecs: 90 * 60,
      isPaused: false,
      sessionId: null,
    },
    bandwidth: { work: 60, personal: 15, admin: 15, learning: 10 },
  });
});

describe("AppStore", () => {
  it("defaults to today mode", () => {
    expect(useAppStore.getState().mode).toBe("today");
  });

  it("switches modes", () => {
    useAppStore.getState().setMode("focus");
    expect(useAppStore.getState().mode).toBe("focus");
  });

  it("manages tasks", () => {
    const tasks = [
      {
        id: "t1",
        day: "2025-05-06",
        kind: "must" as const,
        idx: 1,
        text: "Test",
        done: false,
      },
    ];
    useAppStore.getState().setTasks(tasks);
    expect(useAppStore.getState().tasks).toHaveLength(1);

    useAppStore.getState().toggleTask("t1");
    expect(useAppStore.getState().tasks[0].done).toBe(true);

    useAppStore.getState().toggleTask("t1");
    expect(useAppStore.getState().tasks[0].done).toBe(false);
  });

  it("manages captures", () => {
    const cap = { id: "c1", text: "Test", created_at: "2025-05-06T12:00:00Z" };
    useAppStore.getState().addCapture(cap);
    expect(useAppStore.getState().captures).toHaveLength(1);
    expect(useAppStore.getState().captures[0].text).toBe("Test");
  });

  it("starts focus with new timer", () => {
    useAppStore.getState().startFocus("My task");
    const f = useAppStore.getState().focus;
    expect(f.task).toBe("My task");
    expect(f.remainingSecs).toBe(90 * 60);
    expect(f.isPaused).toBe(false);
    expect(useAppStore.getState().mode).toBe("focus");
  });

  it("pauses focus and preserves timer", () => {
    useAppStore.getState().startFocus("My task");
    // Simulate some ticks
    useAppStore.getState().tickFocus();
    useAppStore.getState().tickFocus();
    useAppStore.getState().tickFocus();
    expect(useAppStore.getState().focus.remainingSecs).toBe(90 * 60 - 3);

    // Pause
    useAppStore.getState().pauseFocus();
    expect(useAppStore.getState().focus.isPaused).toBe(true);
    expect(useAppStore.getState().focus.remainingSecs).toBe(90 * 60 - 3);
    expect(useAppStore.getState().mode).toBe("today");

    // Tick should not change when paused
    useAppStore.getState().tickFocus();
    expect(useAppStore.getState().focus.remainingSecs).toBe(90 * 60 - 3);
  });

  it("resumes focus with preserved timer", () => {
    useAppStore.getState().startFocus("My task");
    useAppStore.getState().tickFocus();
    useAppStore.getState().tickFocus();
    useAppStore.getState().pauseFocus();

    useAppStore.getState().resumeFocus();
    expect(useAppStore.getState().focus.isPaused).toBe(false);
    expect(useAppStore.getState().focus.remainingSecs).toBe(90 * 60 - 2);
    expect(useAppStore.getState().mode).toBe("focus");
  });

  it("resumes same task via startFocus without resetting timer", () => {
    useAppStore.getState().startFocus("My task");
    useAppStore.getState().tickFocus();
    useAppStore.getState().tickFocus();
    useAppStore.getState().pauseFocus();

    // Call startFocus with same task — should resume, not reset
    useAppStore.getState().startFocus("My task");
    expect(useAppStore.getState().focus.remainingSecs).toBe(90 * 60 - 2);
  });

  it("resets timer on done", () => {
    useAppStore.getState().startFocus("My task");
    useAppStore.getState().tickFocus();
    useAppStore.getState().exitFocus("done");
    expect(useAppStore.getState().focus.task).toBeNull();
    expect(useAppStore.getState().focus.remainingSecs).toBe(90 * 60);
    expect(useAppStore.getState().mode).toBe("today");
  });

  it("manages signals", () => {
    expect(useAppStore.getState().signals).toBeNull();

    const sig = {
      focus_state: "stable" as const,
      active_threads: 0,
      error_rate: 0,
      error_baseline: 1.0,
      open_loops: 0,
      cutoff_hour: 16.5,
      cognitive_threshold_pct: 0,
      interventions: [],
    };
    useAppStore.getState().setSignals(sig);
    expect(useAppStore.getState().signals).toEqual(sig);
  });

  it("manages toast", () => {
    expect(useAppStore.getState().toast).toBeNull();

    useAppStore.getState().setToast({ msg: "Test", action: "OK" });
    expect(useAppStore.getState().toast).toEqual({ msg: "Test", action: "OK" });

    useAppStore.getState().setToast(null);
    expect(useAppStore.getState().toast).toBeNull();
  });

  it("manages bandwidth", () => {
    const bw = { work: 50, personal: 20, admin: 20, learning: 10 };
    useAppStore.getState().setBandwidth(bw);
    expect(useAppStore.getState().bandwidth).toEqual(bw);
  });
});
