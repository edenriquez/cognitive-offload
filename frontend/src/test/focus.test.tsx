import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FocusMode from "../components/modes/FocusMode";

beforeEach(() => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: "stopped", outcome: "done" }),
    text: () => Promise.resolve(""),
  } as Response);
});

describe("FocusMode", () => {
  it("renders task name", () => {
    render(<FocusMode task="Ship retry-logic v2" onExit={() => {}} />);
    expect(screen.getByText("Ship retry-logic v2")).toBeInTheDocument();
  });

  it("shows countdown timer", () => {
    render(<FocusMode task="Test" onExit={() => {}} />);
    expect(screen.getByText("90:00")).toBeInTheDocument();
  });

  it("shows Pause and Done buttons", () => {
    render(<FocusMode task="Test" onExit={() => {}} />);
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows why-this-task toggle", () => {
    render(<FocusMode task="Test" onExit={() => {}} />);
    expect(screen.getByText("why this task")).toBeInTheDocument();
  });

  it("calls onExit when Done clicked", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<FocusMode task="Test" onExit={onExit} />);
    await user.click(screen.getByText("Done"));
    expect(onExit).toHaveBeenCalled();
  });

  it("calls onExit when Pause clicked", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<FocusMode task="Test" onExit={onExit} />);
    await user.click(screen.getByText("Pause"));
    expect(onExit).toHaveBeenCalled();
  });

  it("does not crash with empty task", () => {
    render(<FocusMode task="" onExit={() => {}} />);
    expect(screen.getByText("Pick a task")).toBeInTheDocument();
  });

  it("does not crash when api.stopFocus rejects", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<FocusMode task="Test" onExit={onExit} />);
    await user.click(screen.getByText("Done"));
    expect(onExit).toHaveBeenCalled();
  });

  it("reveals context when clicked", async () => {
    const user = userEvent.setup();
    render(<FocusMode task="Test" onExit={() => {}} />);
    await user.click(screen.getByText("why this task"));
    expect(screen.getByText(/auth-success/)).toBeInTheDocument();
  });
});
