/**
 * Platform-default settings (Part 11).
 *
 * These are the CURRENT hardcoded values formerly frozen in
 * src/alerts/thresholds.ts. They act as FALLBACKS whenever a farm has no
 * override row in the `settings` table — per-farm overrides always win.
 *
 * Single source of truth for:
 *   - which keys exist (SETTINGS_KEYS / SettingsKey)
 *   - their default values
 *   - validation bounds accepted from the API
 */

export const DEFAULT_SETTINGS = {
  moistureLow: 30, // %
  moistureHigh: 85, // %
  batteryLow: 20, // %
  batteryCritical: 10, // %
  nitrogenLow: 100, // ppm
  phosphorusLow: 20, // ppm
  potassiumLow: 70, // ppm
  soilTempLowExtreme: 5, // °C
  soilTempHighExtreme: 35, // °C
  offlineMinutes: 10, // min of silence before a node is flagged offline
  irrigationMaxRunningMinutes: 240, // min a valve may stay open before a long-running warning fires
} as const;

/** Per-node telemetry cadence used when nodes.read_interval_ms is NULL. */
export const DEFAULT_READ_INTERVAL_MS = 60_000;

export type SettingsKey = keyof typeof DEFAULT_SETTINGS;
export type FarmSettings = Record<SettingsKey, number>;

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

/** Sanity bounds enforced on writes (defaults comfortably inside). */
export const SETTINGS_BOUNDS: Record<SettingsKey, { min: number; max: number }> = {
  moistureLow: { min: 0, max: 100 },
  moistureHigh: { min: 0, max: 100 },
  batteryLow: { min: 0, max: 100 },
  batteryCritical: { min: 0, max: 100 },
  nitrogenLow: { min: 0, max: 2000 },
  phosphorusLow: { min: 0, max: 2000 },
  potassiumLow: { min: 0, max: 2000 },
  soilTempLowExtreme: { min: -50, max: 80 },
  soilTempHighExtreme: { min: -50, max: 80 },
  offlineMinutes: { min: 1, max: 1440 },
  irrigationMaxRunningMinutes: { min: 1, max: 1440 },
};

export function isSettingsKey(key: string): key is SettingsKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}
