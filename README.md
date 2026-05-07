# Cogload — Cognitive Load Management

<p align="center">
  <img src="docs/screenshot.png" alt="Cogload Screenshot" width="800" />
</p>

A native macOS developer productivity tool that observes your cognitive state through real-time signals — file activity, LLM sessions, error rates, thread fragmentation — and intervenes before you burn out.

Built with **Tauri 2** (Rust native shell) + **React 18** + **TypeScript** frontend and a **Go** backend daemon.

## Core Modes

| Mode | Purpose |
|------|---------|
| **Focus** | Deep work timer with task context, progress bar, 90-min blocks |
| **Today** | Daily MUST-WIN tasks, bandwidth ring, thread gravity, inline guidance |
| **Capture** | Zero-friction brain dump — just type and press Enter |
| **Review** | Auto-generated daily audit: energy map, patterns, time leaks |
| **Tomorrow** | Auto-generated recovery plan with enforced constraints |

## Key Systems

- **Enforcement Engine** — 11 rule-based interventions (block/warn/info) from real-time signals
- **Signal Strip** — Live indicators: focus state, active threads, error rate, open loops, cutoff timer
- **Energy Map** — Time-series activity visualization with annotated problem regions
- **Thread Management** — Performance degradation detection, orphan tracking, gravity cards
- **Bandwidth Allocation** — Donut chart tracking work/personal/admin/learning time splits

## Architecture

```
┌─────────────────────────────────────────────────┐
│           NATIVE APP (Tauri 2 / Rust)           │
│   Real macOS window · overlay titlebar          │
│   Wraps React frontend via WebView              │
├─────────────────────────────────────────────────┤
│          FRONTEND (React + TypeScript)           │
│   5 modes · Zustand state · CSS design system   │
│   WebSocket client for live signal updates       │
├─────────────────────────────────────────────────┤
│            BACKEND (Go daemon)                   │
│   REST API · WebSocket · SQLite (WAL mode)      │
│   Event ingestion · Pattern detection            │
│   Enforcement engine · 16 API endpoints          │
└─────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Native shell | Tauri 2 (Rust) |
| Frontend | React 18, TypeScript, Zustand, Vite |
| Backend | Go, chi router, SQLite, gorilla/websocket |
| Styling | Custom CSS with design tokens |
| Charts | Custom SVG (energy map, bandwidth ring) |

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (for Tauri native shell)
- [Node.js](https://nodejs.org/) 18+
- [Go](https://go.dev/) 1.23+ (for backend)

### Run the native app

```bash
cd frontend
npm install
npm run tauri dev
```

### Run the backend (optional — app works with demo data without it)

```bash
cd backend
go run ./cmd/cogload
```

The backend starts on `http://127.0.0.1:9200` with:
- REST API at `/api/v1/*`
- WebSocket at `/ws/signals`
- SQLite database at `~/.cogload/cogload.db`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Focus mode |
| `2` | Today mode |
| `3` | Capture mode |
| `4` | Review mode |
| `5` | Tomorrow mode |
| `Esc` | Back to Today |

## Project Structure

```
cognitive-offload/
├── frontend/                    # Tauri + React app
│   ├── src-tauri/               # Rust native shell
│   │   ├── Cargo.toml
│   │   ├── src/lib.rs           # Tauri setup, overlay titlebar
│   │   └── tauri.conf.json      # Window config
│   ├── src/
│   │   ├── App.tsx              # Main app shell
│   │   ├── components/modes/    # 5 mode components
│   │   ├── components/shared/   # Ring, EnergyMap
│   │   ├── store/app-store.ts   # Zustand state
│   │   ├── styles/              # Design system CSS
│   │   └── types/index.ts       # TypeScript interfaces
│   └── package.json
├── backend/                     # Go API daemon
│   ├── cmd/cogload/main.go      # Entry point
│   └── internal/
│       ├── api/router.go        # 16 REST endpoints
│       ├── engine/engine.go     # 11 enforcement rules
│       ├── store/store.go       # SQLite persistence
│       ├── ws/hub.go            # WebSocket hub
│       └── models/models.go     # Domain types
└── README.md
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/today` | Today's tasks, bandwidth, active thread |
| `PATCH` | `/api/v1/today/tasks/:id` | Toggle task completion |
| `POST` | `/api/v1/focus/start` | Start focus session |
| `POST` | `/api/v1/focus/stop` | End focus session |
| `POST` | `/api/v1/captures` | Create brain dump capture |
| `GET` | `/api/v1/captures` | List recent captures |
| `GET` | `/api/v1/review/:day` | Full daily audit |
| `GET` | `/api/v1/tomorrow` | Auto-generated plan |
| `POST` | `/api/v1/tomorrow/lock` | Lock in tomorrow's plan |
| `GET` | `/api/v1/sessions` | List sessions |
| `POST` | `/api/v1/sessions/:id/close` | Close/archive thread |
| `GET` | `/api/v1/interventions` | Active enforcement rules |
| `GET` | `/api/v1/signals/current` | Signal snapshot (HTTP) |
| `POST` | `/api/v1/ingest/events` | Batch event ingestion |
| `WS` | `/ws/signals` | Real-time signal push |

## License

MIT
