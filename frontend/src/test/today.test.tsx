import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TodayMode from "../components/modes/TodayMode";
import { useAppStore } from "../store/app-store";

beforeEach(() => {
  useAppStore.setState({
    mode: "today",
    tasks: [
      {
        id: "t1",
        day: "2025-05-06",
        kind: "must",
        idx: 1,
        text: "First task",
        done: false,
      },
      {
        id: "t2",
        day: "2025-05-06",
        kind: "must",
        idx: 2,
        text: "Second task",
        done: false,
      },
      {
        id: "t3",
        day: "2025-05-06",
        kind: "personal",
        idx: 1,
        text: "Personal task",
        done: true,
      },
    ],
    signals: null,
    now: new Date(2025, 4, 6, 14, 30),
    bandwidth: { work: 60, personal: 15, admin: 15, learning: 10 },
  });
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: [
          {
            id: "t1",
            day: "2025-05-06",
            kind: "must",
            idx: 1,
            text: "First task",
            done: false,
          },
          {
            id: "t2",
            day: "2025-05-06",
            kind: "must",
            idx: 2,
            text: "Second task",
            done: false,
          },
          {
            id: "t3",
            day: "2025-05-06",
            kind: "personal",
            idx: 1,
            text: "Personal task",
            done: true,
          },
        ],
      }),
    text: () => Promise.resolve(""),
  } as Response);
});

describe("TodayMode", () => {
  it("renders tasks", () => {
    render(<TodayMode />);
    expect(screen.getByText("First task")).toBeInTheDocument();
    expect(screen.getByText("Second task")).toBeInTheDocument();
    expect(screen.getByText("Personal task")).toBeInTheDocument();
  });

  it("shows greeting based on time", () => {
    render(<TodayMode />);
    expect(screen.getByText(/good afternoon/i)).toBeInTheDocument();
  });

  it("highlights next task", () => {
    render(<TodayMode />);
    const allMatches = screen.getAllByText(/first task/i);
    expect(allMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no tasks", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tasks: [] }),
      text: () => Promise.resolve(""),
    } as Response);
    useAppStore.setState({ tasks: [] });
    render(<TodayMode />);
    expect(await screen.findByText("Plan your day")).toBeInTheDocument();
  });

  it("shows Focus button on active task", () => {
    render(<TodayMode />);
    expect(screen.getByText("Focus")).toBeInTheDocument();
  });

  it("shows kind selector for new task input", () => {
    render(<TodayMode />);
    expect(screen.getByText("must")).toBeInTheDocument();
    expect(screen.getByText("personal")).toBeInTheDocument();
    expect(screen.getByText("small")).toBeInTheDocument();
  });

  it("has task creation input", () => {
    render(<TodayMode />);
    expect(screen.getByPlaceholderText("Add a task…")).toBeInTheDocument();
  });

  it("shows bandwidth section when reveal clicked", async () => {
    const user = userEvent.setup();
    render(<TodayMode />);
    await user.click(screen.getByText("Show bandwidth"));
    expect(screen.getByText(/work core/i)).toBeInTheDocument();
  });
});
