import { TelemetryPayload } from "../schemas/telemetryPayload.schema";
import { pool } from "../../db/pool";
import { evaluateTelemetryReading } from "../../alerts/alertEngine";
import { createAlertIfNotExists } from "../../services/alertService";

/**
 * Telemetry ingestion — Part 4 (+ Part 8 alert evaluation).
 *
 * Contract (see schemas/telemetryPayload.schema.ts):
 *  1. topic parsed upstream (ingest.ts) → { orgId, farmId, nodeId }
 *  2. payload validated against zod upstream
 *  3. HERE: node existence + farm-membership integrity check
 *  4. insert telemetry row (idempotent via ON CONFLICT DO NOTHING)
 *  5. refresh nodes.battery / rssi / last_seen_at / status='online'
 *  6. Part 8: run the reading through the alert engine; breaches persist
 *     via createAlertIfNotExists (deduped per open occurrence)
 */

type NodeRecord = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  name: string;
};

export async function handleTelemetry(
  nodeId: string,
  farmId: string,
  payload: TelemetryPayload,
  receivedAt: Date
): Promise<void> {
  // ── 3. integrity check: node must exist AND belong to the claimed farm ──
  const nodeResult = await pool.query<NodeRecord>(
    `SELECT id, farm_id, zone_id, name FROM nodes WHERE id = $1`,
    [nodeId]
  );
  if (nodeResult.rowCount === 0) {
    console.warn(
      `[mqtt-ingest] ⚠ dropped telemetry for UNKNOWN node "${nodeId}" (farm ${farmId}) — not registered`
    );
    return;
  }
  const node = nodeResult.rows[0];
  if (node.farm_id !== farmId) {
    // A node publishing under the wrong farm is a real integrity problem,
    // not noise — log it loudly and refuse the data.
    console.error(
      `[mqtt-ingest] 🚨 INTEGRITY: node "${nodeId}" published under farm ${farmId} but is registered under ${node.farm_id} — message rejected`
    );
    return;
  }

  // Absent timestamp → server receive time (spec contract)
  const time = payload.timestamp ? new Date(payload.timestamp) : receivedAt;

  // ── 4. idempotent insert (retried publishes dedupe on (node_id, time)) ──
  const inserted = await pool.query(
    `
    INSERT INTO telemetry (
      time, node_id, zone_id, farm_id,
      soil_moisture, soil_temp, air_temp, humidity,
      nitrogen, phosphorus, potassium, battery, rssi
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (node_id, time) DO NOTHING
    `,
    [
      time,
      nodeId,
      node.zone_id,
      farmId,
      payload.soilMoisture ?? null,
      payload.soilTemp ?? null,
      payload.airTemp ?? null,
      payload.airHumidity ?? null,
      payload.nitrogen ?? null,
      payload.phosphorus ?? null,
      payload.potassium ?? null,
      payload.battery,
      payload.rssi,
    ]
  );

  // ── 5. keep the node registry fresh; a speaking node is an online node ──
  await pool.query(
    `
    UPDATE nodes
    SET battery = $1,
        rssi = $2,
        last_seen_at = NOW(),
        status = 'online',
        updated_at = NOW()
    WHERE id = $3
    `,
    [payload.battery, payload.rssi, nodeId]
  );

  if ((inserted.rowCount ?? 0) === 0) {
    console.log(
      `[mqtt-ingest] ↺ duplicate ignored node=${nodeId} time=${time.toISOString()} (already ingested)`
    );
    return; // duplicate frame — the alert engine already evaluated this reading
  }

  // ── Part 8: event-driven alert evaluation (Part 11: per-farm thresholds) ─
  // Failures here must never break ingestion itself.
  try {
    const candidates = await evaluateTelemetryReading(payload, {
      id: nodeId,
      name: node.name,
      farmId,
    });
    for (const candidate of candidates) {
      await createAlertIfNotExists(
        nodeId,
        candidate.type,
        candidate.severity,
        candidate.message,
        candidate.value
      );
    }
  } catch (err) {
    console.error(`[mqtt-ingest] 💥 alert evaluation failed for ${nodeId}:`, err);
  }

  // One line per ingested message — this is the field-connectivity debug trail.
  console.log(
    `[mqtt-ingest] ✓ telemetry node=${nodeId} time=${time.toISOString()} ` +
      `moisture=${payload.soilMoisture} battery=${payload.battery} rssi=${payload.rssi}`
  );
}
