import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useAppStore } from "../store/app-store";

// Reset store before each test
beforeEach(() => {
  useAppStore.setState({
    mode: "today",
    tasks: [],
    captures: [],
    signals: null,
    toast: null,
    activeFocusTask: null,
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

  it("shows all 5 mode buttons", () => {
    render(<App />);
    const pills = document.querySelector(".nav-pills")!;
    expect(pills.textContent).toContain("Focus");
    expect(pills.textContent).toContain("Today");
    expect(pills.textContent).toContain("Capture");
    expect(pills.textContent).toContain("Review");
    expect(pills.textContent).toContain("Tomorrow");
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
  it("renders Today mode by default", () => {
    render(<App />);
    expect(screen.getByText(/good/i)).toBeInTheDocument();
  });

  it("renders Capture mode without crashing", () => {
    useAppStore.setState({ mode: "capture" });
    render(<App />);
    expect(
      screen.getByText("Capture · no thinking required"),
    ).toBeInTheDocument();
  });

  it("renders Focus mode without crashing", () => {
    useAppStore.setState({ mode: "focus", activeFocusTask: "Test task" });
    render(<App />);
    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("renders Review mode without crashing", () => {
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
        }),
      text: () => Promise.resolve(""),
    } as Response);
    useAppStore.setState({ mode: "review" });
    render(<App />);
    expect(screen.getByText("Today's review")).toBeInTheDocument();
  });

  it("renders Tomorrow mode without crashing", () => {
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
    const stage = document.querySelector(".stage")!;
    expect(stage.textContent).toMatch(/tomorrow|loading/i);
  });

  it("recovers from error in mode via ErrorBoundary", () => {
    // Force ReviewMode to throw by making fetch return bad data
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    useAppStore.setState({ mode: "review" });
    render(<App />);
    // Should not crash — either shows loading, error boundary, or empty state
    expect(document.querySelector(".app-shell")).toBeInTheDocument();
  });
});
