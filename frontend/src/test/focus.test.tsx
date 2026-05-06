import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FocusMode from "../components/modes/FocusMode";
import { useAppStore } from "../store/app-store";

beforeEach(() => {
  useAppStore.setState({
    focus: {
      task: "Ship retry-logic v2",
      remainingSecs: 5400,
      isPaused: false,
      sessionId: null,
    },
    mode: "focus",
  });
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: "stopped", outcome: "done" }),
    text: () => Promise.resolve(""),
  } as Response);
});

describe("FocusMode", () => {
  it("renders task name from store", () => {
    render(<FocusMode />);
    expect(screen.getByText("Ship retry-logic v2")).toBeInTheDocument();
  });

  it("shows countdown timer from store", () => {
    render(<FocusMode />);
    expect(screen.getByText("90:00")).toBeInTheDocument();
  });

  it("shows Pause and Done buttons", () => {
    render(<FocusMode />);
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows why-this-task toggle", () => {
    render(<FocusMode />);
    expect(screen.getByText("why this task")).toBeInTheDocument();
  });

  it("switches to today on Done", async () => {
    const user = userEvent.setup();
    render(<FocusMode />);
    await user.click(screen.getByText("Done"));
    expect(useAppStore.getState().mode).toBe("today");
    expect(useAppStore.getState().focus.task).toBeNull();
  });

  it("pauses and preserves timer on Pause", async () => {
    // Tick a few times first
    useAppStore.getState().tickFocus();
    useAppStore.getState().tickFocus();

    const user = userEvent.setup();
    render(<FocusMode />);
    await user.click(screen.getByText("Pause"));
    expect(useAppStore.getState().mode).toBe("today");
    expect(useAppStore.getState().focus.isPaused).toBe(true);
    expect(useAppStore.getState().focus.remainingSecs).toBe(5400 - 2);
    expect(useAppStore.getState().focus.task).toBe("Ship retry-logic v2");
  });

  it("does not crash with empty task", () => {
    useAppStore.setState({
      focus: {
        task: null,
        remainingSecs: 5400,
        isPaused: false,
        sessionId: null,
      },
    });
    render(<FocusMode />);
    expect(screen.getByText("Pick a task")).toBeInTheDocument();
  });

  it("reveals context when clicked", async () => {
    const user = userEvent.setup();
    render(<FocusMode />);
    await user.click(screen.getByText("why this task"));
    expect(screen.getByText(/auth-success/)).toBeInTheDocument();
  });
});
