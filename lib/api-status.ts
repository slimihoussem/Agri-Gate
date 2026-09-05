"use client";

import { ERROR_THRESHOLD } from "./constants";

/**
 * Global API connectivity store — feeds the TopBar cloud badge with REAL
 * connection state instead of a mock switcher.
 *
 *   connected : last poll succeeded
 *   offline   : fetch failed but retrying (1–2 consecutive failures)
 *   error     : repeated consecutive failures (≥ ERROR_THRESHOLD)
 *
 * Implemented as a tiny external store so every polling hook reports into
 * it while TopBar subscribes via useSyncExternalStore (no context needed).
 */

export type CloudSyncState = "connected" | "offline" | "error";

export interface ApiStatus {
  state: CloudSyncState;
  /** Timestamp (ms) of the last successful request, null before first success. */
  lastSyncAt: number | null;
  consecutiveFailures: number;
}

let status: ApiStatus = { state: "offline", lastSyncAt: null, consecutiveFailures: 0 };
const listeners = new Set<() => void>();

function emit(next: ApiStatus): void {
  if (
    next.state === status.state &&
    next.consecutiveFailures === status.consecutiveFailures &&
    // lastSyncAt changes on every success — don't re-render for the same second
    Math.floor((next.lastSyncAt ?? 0) / 1000) === Math.floor((status.lastSyncAt ?? 0) / 1000)
  ) {
    return;
  }
  status = next;
  listeners.forEach((notify) => notify());
}

export const apiStatusStore = {
  reportSuccess(): void {
    emit({ state: "connected", lastSyncAt: Date.now(), consecutiveFailures: 0 });
  },
  reportFailure(): void {
    const failures = status.consecutiveFailures + 1;
    emit({
      state: failures >= ERROR_THRESHOLD ? "error" : "offline",
      lastSyncAt: status.lastSyncAt,
      consecutiveFailures: failures,
    });
  },

  getState(): ApiStatus {
    return status;
  },

  subscribe(notify: () => void): () => void {
    listeners.add(notify);
    return () => listeners.delete(notify);
  },

  /** "synced Xm ago" label for the badge. */
  describeLastSync(): string {
    if (status.lastSyncAt === null) return "never";
    const seconds = Math.max(0, Math.floor((Date.now() - status.lastSyncAt) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  },
};
