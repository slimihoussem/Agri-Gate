/** Central knob for near-realtime polling across all data hooks. */
export const POLL_INTERVAL_MS = 20_000;

/**
 * Consecutive failed polls before the TopBar badge flips to "Error".
 * 1–2 failures → "Offline (retrying)"; ≥ this → "Error".
 */
export const ERROR_THRESHOLD = 3;

const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const API_BASE_URL = raw.replace(/\/$/, "");
