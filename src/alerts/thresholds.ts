/**
 * ─── MOVED (Part 11): thresholds are now per-farm, not global ──────────────
 * The values below are the platform DEFAULTS and live in
 * src/settings/defaults.ts. Farms override them through
 * PATCH /api/farms/:farmId/settings; the alert engine reads the MERGED
 * settings via settingsService.getSettings(farmId) on every evaluation.
 *
 * This re-export exists only for code that legitimately needs the global
 * fallback today:
 *   - src/alerts/offlineSweep.ts (global sweep interval gate)
 * Everything else must use settingsService.getSettings(farmId).
 */
export { DEFAULT_SETTINGS as THRESHOLDS } from "../settings/defaults";
