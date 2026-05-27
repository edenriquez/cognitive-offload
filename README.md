# Cogload

<p align="center">
  <img src="docs/screenshot.png" alt="Cogload" width="800" />
</p>

A native macOS app that tracks your cognitive load and intervenes before you burn out.

**Stack:** Tauri 2 (Rust) · React + TypeScript · Go backend · SQLite

## Run

```bash
# native app
cd frontend && npm install && npm run tauri dev

# backend (optional)
cd backend && go run ./cmd/cogload
```

Backend listens on `http://127.0.0.1:9200`. App works with demo data when backend is offline.

## Modes

- **Today** — tasks, bandwidth, active thread
- **Map** — task graph with dependencies and timeline
- **Review** — daily audit, patterns, energy map
- **Sources** — inputs and integrations
- **Settings** — preferences

## License

MIT
