import { useAppStore } from "./app-store";
import type { SignalSnapshot } from "../types";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_INTERVAL = 30_000;

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${proto}//${host}/ws/signals`;
}

function isValidSnapshot(data: unknown): data is SignalSnapshot {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.focus_state === "string" &&
    typeof d.active_threads === "number" &&
    typeof d.error_rate === "number"
  );
}

function connect() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  let socket: WebSocket;
  try {
    socket = new WebSocket(getWsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    console.log("[ws] connected");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const raw = JSON.parse(event.data);
      if (isValidSnapshot(raw)) {
        // Ensure arrays are never null
        const snapshot: SignalSnapshot = {
          ...raw,
          interventions: Array.isArray(raw.interventions)
            ? raw.interventions
            : [],
        };
        useAppStore.getState().setSignals(snapshot);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  socket.onclose = () => {
    console.debug("[ws] disconnected");
    if (ws === socket) ws = null;
    // Do NOT clear signals on disconnect — keep last known state
    scheduleReconnect();
  };

  socket.onerror = () => {
    console.debug("[ws] error, will reconnect");
    socket.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s
  const delay = Math.min(
    2000 * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_INTERVAL,
  );
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function startSignalStream() {
  connect();
}

export function stopSignalStream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  if (ws) {
    ws.close();
    ws = null;
  }
}
