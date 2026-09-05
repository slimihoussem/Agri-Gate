import { pool } from "../db/pool";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  SETTINGS_BOUNDS,
  isSettingsKey,
  FarmSettings,
  SettingsKey,
} from "./defaults";

/**
 * Settings service — Part 11.
 *
 * getSettings(farmId) merges the platform defaults with any override rows in
 * the `settings` table, returning one flat numeric object. Callers (alert
 * engine, offline sweep) never need to know whether a value is a default or
 * an override.
 */

type SettingsRow = { key: string; value: string };

export async function getSettings(farmId: string): Promise<FarmSettings> {
  const result = await pool.query<SettingsRow>(
    `SELECT key, value FROM settings WHERE farm_id = $1`,
    [farmId]
  );

  const merged: FarmSettings = { ...DEFAULT_SETTINGS };
  for (const row of result.rows) {
    if (isSettingsKey(row.key)) {
      const parsed = Number(row.value);
      if (!Number.isNaN(parsed)) {
        merged[row.key] = parsed;
      }
    }
    // Unknown keys in the table are ignored defensively.
  }
  return merged;
}

export class SettingsValidationError extends Error {
  constructor(public readonly issues: { key: string; message: string }[]) {
    super(
      `Invalid settings: ${issues.map((i) => `${i.key} — ${i.message}`).join("; ")}`
    );
    this.name = "SettingsValidationError";
  }
}

/**
 * Upserts override rows (one row per key) and returns the freshly merged
 * settings. Unknown keys or out-of-bounds values raise
 * SettingsValidationError BEFORE any write happens (all-or-nothing).
 */
export async function updateSettings(
  farmId: string,
  updates: Record<string, unknown>,
  updatedBy: string | null
): Promise<FarmSettings> {
  const entries = Object.entries(updates ?? {});
  const issues: { key: string; message: string }[] = [];

  if (entries.length === 0) {
    throw new SettingsValidationError([{ key: "(body)", message: "Provide at least one setting to update" }]);
  }

  const clean: [SettingsKey, number][] = [];
  for (const [key, rawValue] of entries) {
    if (!isSettingsKey(key)) {
      issues.push({ key, message: "unknown settings key" });
      continue;
    }
    const value = typeof rawValue === "string" ? Number(rawValue) : rawValue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ key, message: "must be a finite number" });
      continue;
    }
    const bounds = SETTINGS_BOUNDS[key];
    if (value < bounds.min || value > bounds.max) {
      issues.push({ key, message: `must be between ${bounds.min} and ${bounds.max}` });
      continue;
    }
    clean.push([key, value]);
  }

  // Cross-field sanity: low thresholds must sit below their high counterparts.
  const candidate = await getSettings(farmId);
  for (const [key, value] of clean) candidate[key] = value;
  if (candidate.moistureLow >= candidate.moistureHigh) {
    issues.push({ key: "moistureLow", message: "moistureLow must be below moistureHigh" });
  }
  if (candidate.batteryCritical > candidate.batteryLow) {
    issues.push({ key: "batteryCritical", message: "batteryCritical must be <= batteryLow" });
  }
  if (candidate.soilTempLowExtreme >= candidate.soilTempHighExtreme) {
    issues.push({ key: "soilTempLowExtreme", message: "soilTempLowExtreme must be below soilTempHighExtreme" });
  }

  if (issues.length > 0) throw new SettingsValidationError(issues);

  // All-or-nothing upsert of the valid keys.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of clean) {
      await client.query(
        `
        INSERT INTO settings (farm_id, key, value, updated_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (farm_id, key)
        DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        `,
        [farmId, key, value, updatedBy]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getSettings(farmId);
}

export { DEFAULT_SETTINGS, SETTINGS_KEYS };

// ── Part 13: per-node overrides (three-tier precedence) ─────────────────────

export type SettingsSource = "default" | "farm" | "node";

export interface EffectiveThresholds {
  values: FarmSettings;
  sources: Record<SettingsKey, SettingsSource>;
}

/** A node's farm_id for tenant gates + farm-layer resolution; null if unknown. */
export async function getFarmIdForNode(nodeId: string): Promise<string | null> {
  const result = await pool.query<{ farm_id: string }>(
    `SELECT farm_id FROM nodes WHERE id = $1`,
    [nodeId]
  );
  return result.rowCount === 0 ? null : result.rows[0].farm_id;
}

/**
 * Fully-resolved thresholds for ONE node:
 *   defaults  → overlaid by farm `settings` rows → overlaid by node_settings rows.
 * Returns the merged values AND the source of each key so the UI can show
 * "inherited from farm" vs "custom override" per field.
 */
export async function getEffectiveThresholds(nodeId: string): Promise<EffectiveThresholds> {
  const values: FarmSettings = { ...DEFAULT_SETTINGS };
  const sources = Object.fromEntries(
    SETTINGS_KEYS.map((k) => [k, "default" as SettingsSource])
  ) as Record<SettingsKey, SettingsSource>;

  const nodeIdIsKnown = await pool.query(`SELECT 1 FROM nodes WHERE id = $1`, [nodeId]);
  if (nodeIdIsKnown.rowCount === 0) {
    // Unknown node — return pure defaults rather than leaking existence.
    return { values, sources };
  }

  const farmId = await getFarmIdForNode(nodeId);

  if (farmId) {
    const farmRows = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE farm_id = $1`,
      [farmId]
    );
    for (const row of farmRows.rows) {
      if (isSettingsKey(row.key)) {
        const parsed = Number(row.value);
        if (!Number.isNaN(parsed)) {
          values[row.key] = parsed;
          sources[row.key] = "farm";
        }
      }
    }
  }

  const nodeRows = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM node_settings WHERE node_id = $1`,
    [nodeId]
  );
  for (const row of nodeRows.rows) {
    if (isSettingsKey(row.key)) {
      const parsed = Number(row.value);
      if (!Number.isNaN(parsed)) {
        values[row.key] = parsed;
        sources[row.key] = "node";
      }
    }
  }

  return { values, sources };
}

type NodeSettingsRow = { value: string };

/** Upserts ONE node-level override (validated against bounds). */
export async function updateNodeSetting(
  nodeId: string,
  key: string,
  rawValue: unknown,
  updatedBy: string | null
): Promise<void> {
  if (!isSettingsKey(key)) {
    throw new SettingsValidationError([{ key, message: "unknown settings key" }]);
  }
  const value = typeof rawValue === "string" ? Number(rawValue) : rawValue;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SettingsValidationError([{ key, message: "must be a finite number" }]);
  }
  const bounds = SETTINGS_BOUNDS[key];
  if (value < bounds.min || value > bounds.max) {
    throw new SettingsValidationError([
      { key, message: `must be between ${bounds.min} and ${bounds.max}` },
    ]);
  }

  await pool.query(
    `
    INSERT INTO node_settings (node_id, key, value, updated_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (node_id, key)
    DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `,
    [nodeId, key, value, updatedBy]
  );
}

/** Removes one override — the key reverts to farm setting (or default). */
export async function deleteNodeSetting(nodeId: string, key: string): Promise<boolean> {
  if (!isSettingsKey(key)) return false;
  const result = await pool.query(
    `DELETE FROM node_settings WHERE node_id = $1 AND key = $2`,
    [nodeId, key]
  );
  return (result.rowCount ?? 0) > 0;
}
