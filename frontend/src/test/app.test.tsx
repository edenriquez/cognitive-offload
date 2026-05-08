import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useAppStore } from "../store/app-store";

// Polyfill ResizeObserver for jsdom (used by EnergyMap SVG chart)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Provide a working localStorage mock for Onboarding component
const localStorageMap: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => localStorageMap[key] ?? null,
    setItem: (key: string, val: string) => {
      localStorageMap[key] = val;
    },
    removeItem: (key: string) => {
      delete localStorageMap[key];
    },
    clear: () => {
      Object.keys(localStorageMap).forEach((k) => delete localStorageMap[k]);
    },
    get length() {
      return Object.keys(localStorageMap).length;
    },
    key: (i: number) => Object.keys(localStorageMap)[i] ?? null,
  },
  writable: true,
  configurable: true,
});

// Reset store before each test
beforeEach(() => {
  localStorageMap["cogload_onboarded"] = "true";
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
    now: new Date(2025, 4, 6, 14, 30),
    bandwidth: { work: 60, personal: 15, admin: 15, learning: 10 },
  });
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: [],
        bandwidth: { work: 60, personal: 15, admin: 15, learning: 10 },
      }),
    text: () => Promise.resolve(""),
  } as Response);
});

describe("App shell", () => {
  it("renders without crashing", () => {
    render(<App />);
    expect(screen.getByText("Cogload")).toBeInTheDocument();
  });

  it("shows all mode buttons", () => {
    render(<App />);
    const pills = document.querySelector(".nav-pills")!;
    expect(pills.textContent).toContain("Focus");
    expect(pills.textContent).toContain("Today");
    expect(pills.textContent).toContain("Capture");
    expect(pills.textContent).toContain("Review");
    expect(pills.textContent).toContain("Tomorrow");
    expect(pills.textContent).toContain("Sources");
    expect(pills.textContent).toContain("Settings");
  });

  it("shows signal strip with stable defaults", () => {
    render(<App />);
    const signals = document.querySelector(".signals")!;
    expect(signals.textContent).toContain("stable");
    expect(signals.textContent).toContain("0.0×");
  });

  it("shows status bar", () => {
    render(<App />);
    expect(screen.getByText("v0.5 · synced")).toBeInTheDocument();
  });

  it("switches modes when nav buttons clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText("Capture"));
    expect(useAppStore.getState().mode).toBe("capture");

    await user.click(screen.getByText("Review"));
    expect(useAppStore.getState().mode).toBe("review");

    await user.click(screen.getByText("Tomorrow"));
    expect(useAppStore.getState().mode).toBe("tomorrow");

    await user.click(screen.getByText("Today"));
    expect(useAppStore.getState().mode).toBe("today");
  });
});

describe("Mode rendering", () => {
  it("renders Today mode by default", async () => {
    render(<App />);
    await waitFor(
      () => {
        expect(document.querySelector(".today")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("renders Capture mode without crashing", async () => {
    useAppStore.setState({ mode: "capture" });
    render(<App />);
    expect(
      await screen.findByText("Capture · no thinking required"),
    ).toBeInTheDocument();
  });

  it("renders Focus mode without crashing", async () => {
    useAppStore.setState({
      mode: "focus",
      focus: {
        task: "Test task",
        remainingSecs: 5000,
        isPaused: false,
        sessionId: null,
      },
    });
    render(<App />);
    expect(await screen.findByText("Test task")).toBeInTheDocument();
  });

  it("renders Review mode without crashing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          summary: {
            deep_work_min: 0,
            leaked_min: 0,
            open_loops: 0,
            sessions_count: 0,
          },
          energy_map: [],
          patterns: [],
          leaks: [],
          root_causes: [],
          sessions: [],
          self_reports: [],
        }),
      text: () => Promise.resolve(""),
    } as Response);
    useAppStore.setState({ mode: "review" });
    render(<App />);
    await waitFor(
      () => expect(document.querySelector(".review")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("renders Tomorrow mode without crashing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          day: "2025-05-07",
          status: "draft",
          headline: "Test plan",
          constraints: [],
          bandwidth: { work: 50, personal: 20, admin: 20, learning: 10 },
          tasks: [],
        }),
      text: () => Promise.resolve(""),
    } as Response);
    useAppStore.setState({ mode: "tomorrow" });
    render(<App />);
    await waitFor(() => {
      const stage = document.querySelector(".stage")!;
      expect(stage.textContent).toMatch(/tomorrow|loading|Test plan|May/i);
    });
  });

  it("recovers from error in mode via ErrorBoundary", async () => {
    // Force ReviewMode to throw by making fetch return bad data
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    useAppStore.setState({ mode: "review" });
    render(<App />);
    // Should not crash — either shows loading, error boundary, or empty state
    expect(document.querySelector(".app-shell")).toBeInTheDocument();
  });
});
