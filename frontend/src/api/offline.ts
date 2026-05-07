/**
 * Offline detection module.
 *
 * Tracks connectivity via browser online/offline events and a periodic
 * health-check ping to the backend.  Designed to be consumed directly or
 * wired into a Zustand store.
 */

const HEALTH_URL = "/api/v1/signals/current";
const PING_INTERVAL_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 3;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let offline = !navigator.onLine;
let consecutiveFailures = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(offline: boolean) => void>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOffline(value: boolean) {
  if (value === offline) return;
  offline = value;
  listeners.forEach((cb) => cb(offline));
}

async function healthPing(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(HEALTH_URL, { signal: controller.signal });
      if (res.ok) {
        consecutiveFailures = 0;
        setOffline(false);
      } else {
        // Server responded (even with errors) — we're online
        consecutiveFailures = 0;
        setOffline(false);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    consecutiveFailures++;
  }

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    setOffline(true);
  }
}

// ---------------------------------------------------------------------------
// Browser event handlers
// ---------------------------------------------------------------------------

function handleOnline() {
  consecutiveFailures = 0;
  setOffline(false);
}

function handleOffline() {
  setOffline(true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start listening for online/offline events and begin periodic health-check
 * pings.  Safe to call multiple times — subsequent calls are no-ops.
 */
export function startOfflineDetection(): void {
  if (pingTimer !== null) return; // already running

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Kick off an immediate check, then repeat every PING_INTERVAL_MS.
  healthPing();
  pingTimer = setInterval(healthPing, PING_INTERVAL_MS);
}

/**
 * Stop listening and clear the periodic ping timer.
 */
export function stopOfflineDetection(): void {
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);

  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

/**
 * Returns `true` when the app appears to be offline (either the browser
 * reported it or the health-check failed 3 times in a row).
 */
export function isOffline(): boolean {
  return offline;
}

/**
 * Subscribe to offline-state changes.
 *
 * @returns An unsubscribe function.
 */
export function onOfflineChange(cb: (offline: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
