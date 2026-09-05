import { StatusPayload } from "../schemas/telemetryPayload.schema";
import { pool } from "../../db/pool";

/**
 * Status/heartbeat ingestion — Part 4 (+ Part 9 completion tracking).
 * Updates nodes.last_seen_at and nodes.status from the heartbeat.
 * (The spec's "nodes.active" maps to our existing status column — there is
 * no separate boolean in the Part 2 schema.)
 *
 * When the simulated/real actuator reports `irrigationComplete` with a
 * `logId`, the matching irrigation_logs row is closed out: ended_at=now()
 * and water_used_litres = elapsed minutes × SIMULATED_FLOW_L_PER_MIN.
 *
 * Offline DETECTION (flagging + node_offline alerts) lives in
 * src/alerts/offlineSweep.ts — this handler only ever marks nodes ONLINE.
 */

type NodeRecord = {
  id: string;
  farm_id: string;
};

export async function handleStatus(
  nodeId: string,
  farmId: string,
  payload: StatusPayload
): Promise<void> {
  const nodeResult = await pool.query<NodeRecord>(
    `SELECT id, farm_id FROM nodes WHERE id = $1`,
    [nodeId]
  );
  if (nodeResult.rowCount === 0) {
    console.warn(
      `[mqtt-ingest] ⚠ dropped status for UNKNOWN node "${nodeId}" (farm ${farmId}) — not registered`
    );
    return;
  }
  if (nodeResult.rows[0].farm_id !== farmId) {
    console.error(
      `[mqtt-ingest] 🚨 INTEGRITY: node "${nodeId}" published status under farm ${farmId} but is registered under ${nodeResult.rows[0].farm_id} — message rejected`
    );
    return;
  }

  const nextStatus = payload.online ? "online" : "offline";
  if (payload.battery !== undefined) {
    await pool.query(
      `
      UPDATE nodes
      SET status = $1, battery = $2, last_seen_at = NOW(), updated_at = NOW()
      WHERE id = $3
      `,
      [nextStatus, payload.battery, nodeId]
    );
  } else {
    await pool.query(
      `
      UPDATE nodes
      SET status = $1, last_seen_at = NOW(), updated_at = NOW()
      WHERE id = $2
      `,
      [nextStatus, nodeId]
    );
  }

  console.log(
    `[mqtt-ingest] ✓ status node=${nodeId} online=${payload.online}` +
      (payload.battery !== undefined ? ` battery=${payload.battery}` : "")
  );

  // ── Part 9: actuator completion closes out its irrigation_logs row ───────
  if (payload.irrigationComplete && payload.logId) {
    await completeIrrigationLog(payload.logId);
  }
}

async function completeIrrigationLog(logId: string): Promise<void> {
  // Part 13 ext: use the ACTUATING NODE's own flow_rate_l_per_min. An
  // unmetered actuator records NULL water — visibly unmetered, never guessed.
  const result = await pool.query<{ id: string; flow_rate: number | null }>(
    `
    UPDATE irrigation_logs l
    SET ended_at = NOW(),
        water_used_litres =
          CASE
            WHEN n.flow_rate_l_per_min IS NULL THEN NULL
            ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - l.started_at)) / 60.0)
                 * n.flow_rate_l_per_min::real
          END
    FROM nodes n
    WHERE n.id = l.node_id AND l.id = $1 AND l.skipped = FALSE
    RETURNING l.id, n.flow_rate_l_per_min::float AS flow_rate
    `,
    [logId]
  );

  if ((result.rowCount ?? 0) === 0) {
    console.warn(
      `[mqtt-ingest] ⚠ irrigation completion for unknown/skipped log "${logId}" — ignored`
    );
    return;
  }
  const flow = result.rows[0].flow_rate;
  console.log(
    flow === null
      ? `[mqtt-ingest] 💧 irrigation log ${logId} completed — UNMETERED (no flow_rate configured)`
      : `[mqtt-ingest] 💧 irrigation log ${logId} completed — water metered at ${flow} L/min`
  );
}
