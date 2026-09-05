import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import { AlertDto } from "../schemas/alert.schema";
import type { AlertSeverityValue } from "../alerts/alertEngine";

/** Resolves the farm an alert belongs to (tenant gate) — null when missing. */
export async function getAlertFarmId(alertId: string): Promise<string | null> {
  const result = await pool.query<{ farm_id: string }>(
    `SELECT farm_id FROM alerts WHERE id = $1`,
    [alertId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].farm_id;
}

type AlertRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  zone_name: string | null;
  node_id: string | null;
  type: string;
  severity: string;
  message: string;
  value: string | null;
  triggered_at: Date;
  acknowledged_at: Date | null;
};

function toAlertDto(row: AlertRow): AlertDto {
  return {
    id: row.id,
    farmId: row.farm_id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    nodeId: row.node_id,
    type: row.type,
    severity: row.severity as AlertDto["severity"],
    message: row.message,
    value: row.value,
    triggeredAt: row.triggered_at.toISOString(),
    // Single source of truth for ack state is the timestamp (NULL = unacknowledged).
    acknowledgedAt: row.acknowledged_at ? row.acknowledged_at.toISOString() : null,
    acknowledged: row.acknowledged_at !== null,
  };
}

/**
 * Lists alerts for a farm.
 *  status omitted      → all alerts
 *  status="active"     → unacknowledged only
 *  status="acknowledged" → acknowledged only
 * Order: unacknowledged first, newest triggered_at first within each group.
 */
export async function getAlertsByFarm(
  farmId: string,
  status?: "active" | "acknowledged"
): Promise<AlertDto[]> {
  const ackFilter =
    status === "active"
      ? "AND a.acknowledged_at IS NULL"
      : status === "acknowledged"
        ? "AND a.acknowledged_at IS NOT NULL"
        : "";

  const result = await pool.query<AlertRow>(
    `
    SELECT a.id, a.farm_id, a.zone_id, z.name AS zone_name, a.node_id,
           a.type, a.severity, a.message, a.value, a.triggered_at, a.acknowledged_at
    FROM alerts a
    LEFT JOIN zones z ON z.id = a.zone_id
    WHERE a.farm_id = $1 ${ackFilter}
    ORDER BY (a.acknowledged_at IS NULL) DESC, a.triggered_at DESC
    `,
    [farmId]
  );
  return result.rows.map(toAlertDto);
}

/**
 * Acknowledges an alert: acknowledged_at = NOW() and acknowledged_by = userId.
 * Real auth arrives in Part 10 — for now the client supplies the operator id.
 */
/**
 * ─── Part 8: alert engine persistence ──────────────────────────────────────
 * Creates an alert unless an UNACKNOWLEDGED alert of the same type already
 * exists for this node (i.e. we are already tracking the ongoing issue).
 *
 * Dedupe contract (deliberate):
 *  - open (unacknowledged) duplicate  → SKIP, log it
 *  - acknowledged duplicates          → DO NOT block a new alert: once a
 *    human has closed the previous occurrence, a genuinely NEW breach
 *    must be re-detected and re-reported.
 * There is intentionally NO auto-resolve: alerts persist until acknowledged
 * via PATCH /api/alerts/:alertId/acknowledge, so history shows that
 * something WAS wrong even after conditions return to normal.
 */
export async function createAlertIfNotExists(
  nodeId: string,
  type: string,
  severity: AlertSeverityValue,
  message: string,
  value: string | null
): Promise<{ created: boolean }> {
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id FROM alerts
    WHERE node_id = $1 AND type = $2 AND acknowledged_at IS NULL
    LIMIT 1
    `,
    [nodeId, type]
  );
  if ((existing.rowCount ?? 0) > 0) {
    console.log(
      `[alert-engine] ↷ skip ${type} for ${nodeId} — identical unacknowledged alert already tracking this issue`
    );
    return { created: false };
  }

  // farm_id/zone_id come from the node row — keeps the specified signature.
  const inserted = await pool.query<{ id: string }>(
    `
    INSERT INTO alerts (farm_id, zone_id, node_id, type, severity, message, value)
    SELECT n.farm_id, n.zone_id, n.id, $2, $3, $4, $5
    FROM nodes n
    WHERE n.id = $1
    RETURNING id
    `,
    [nodeId, type, severity, message, value]
  );
  if ((inserted.rowCount ?? 0) === 0) {
    console.warn(`[alert-engine] ⚠ cannot create ${type} alert for UNKNOWN node "${nodeId}"`);
    return { created: false };
  }

  console.log(
    `[alert-engine] 🚨 created ${severity.toUpperCase()} alert "${type}" for ${nodeId}: ${message}`
  );
  return { created: true };
}

/**
 * Acknowledges an alert: acknowledged_at = NOW() and acknowledged_by = userId.
 * Real auth arrives in Part 10 — for now the client supplies the operator id.
 */
export async function acknowledgeAlert(alertId: string, userId?: string): Promise<AlertDto> {
  try {
    const result = await pool.query<AlertRow>(
      `
      WITH updated AS (
        UPDATE alerts
        SET acknowledged_at = NOW(),
            acknowledged_by = $2::uuid
        WHERE id = $1
        RETURNING *
      )
      SELECT u.id, u.farm_id, u.zone_id, z.name AS zone_name, u.node_id,
             u.type, u.severity, u.message, u.value, u.triggered_at, u.acknowledged_at
      FROM updated u
      LEFT JOIN zones z ON z.id = u.zone_id
      `,
      [alertId, userId ?? null]
    );
    if (result.rowCount === 0) {
      throw HttpError.notFound(`Alert ${alertId} not found`);
    }
    return toAlertDto(result.rows[0]);
  } catch (err) {
    // alerts.acknowledged_by → users(id) FK violation means unknown user
    if ((err as { code?: string }).code === "23503") {
      throw new HttpError(400, "userId does not correspond to an existing user");
    }
    throw err;
  }
}
