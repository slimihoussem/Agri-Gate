import { pool } from "../db/pool";
import { getEffectiveThresholds } from "../settings/settingsService";
import { checkOfflineNodes } from "./alertEngine";
import { createAlertIfNotExists } from "../services/alertService";

/**
 * Periodic offline sweep — Part 8 (+ Part 13: per-node silence thresholds).
 *
 * Runs every 2 minutes inside the Part 4 ingestion process. Two checks share
 * the same 2-minute interval:
 *
 * 1. Node offline: each node's effective offlineMinutes is resolved through
 *    the SAME three-tier precedence as every other threshold (defaults <
 *    farm < node override) via settingsService.getEffectiveThresholds(nodeId)
 *    — one node may tolerate 20 minutes of silence while its sibling flags
 *    after 5.
 * 2. Long-running irrigation: any OPEN (ended_at NULL, not skipped) run whose
 *    elapsed time has passed the node's effective
 *    `irrigationMaxRunningMinutes` raises a `irrigation_long_running`
 *    warning. This REPLACES the old max-runtime safety cutoff: the valve is
 *    NEVER force-closed by this sweep — it only notifies, so a forgotten
 *    shutoff or stuck valve is surfaced to a human while the cloud never
 *    silently changes hardware state.
 *
 * NOTE: the Part 2 schema has no boolean `nodes.active` column; "active"
 * here means status <> 'offline' (the same definition used everywhere else).
 *
 * No auto-resolve exists anywhere: when the node starts reporting again,
 * telemetry ingestion flips status back to 'online', but the node_offline
 * alert REMAINS until a human acknowledges it via the Part 3 API. The same
 * applies to irrigation_long_running: closing the valve closes the log row,
 * but the warning stays until acknowledged.
 */

const SWEEP_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

export function startOfflineSweep(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runOfflineSweep().catch((err) => {
      console.error("[alert-engine] 💥 offline sweep failed:", err);
    });
    void runLongRunningIrrigationCheck().catch((err) => {
      console.error("[alert-engine] 💥 long-running irrigation sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);

  console.log(
    `[alert-engine] periodic sweep scheduled — every ${SWEEP_INTERVAL_MS / 1000}s (offline + long-running irrigation, per-node thresholds)`
  );
  return timer;
}

type SilentNodeRow = {
  id: string;
  name: string;
  minutes_silent: number;
};

export async function runOfflineSweep(): Promise<number> {
  // No global cutoff here — each node's OWN threshold decides below.
  const staleResult = await pool.query<SilentNodeRow>(
    `
    SELECT n.id, n.name,
           EXTRACT(EPOCH FROM (NOW() - n.last_seen_at)) / 60 AS minutes_silent
    FROM nodes n
    WHERE n.status <> 'offline'
      AND n.last_seen_at IS NOT NULL
      AND n.last_seen_at < NOW()
    ORDER BY n.id ASC
    `
  );

  if (staleResult.rowCount === 0) return 0;

  let flagged = 0;

  for (const row of staleResult.rows) {
    // Three-tier resolution per node (defaults < farm < node override).
    const { values } = await getEffectiveThresholds(row.id);
    const minutesSilent = Number(row.minutes_silent);
    if (minutesSilent < values.offlineMinutes) continue;

    await pool.query(`UPDATE nodes SET status = 'offline', updated_at = NOW() WHERE id = $1`, [
      row.id,
    ]);
    await createAlertIfNotExists(
      row.id,
      "node_offline",
      "critical",
      `Node "${row.name}" has not reported in over ${values.offlineMinutes} minutes (${Math.round(minutesSilent)} min silent). Check power and WiFi at its location.`,
      `${Math.round(minutesSilent)} min`
    );
    flagged++;
    console.log(
      `[alert-engine] 🔇 ${row.id} flagged offline (silent ${Math.round(minutesSilent)} min ≥ its threshold ${values.offlineMinutes} min)`
    );
  }

  return flagged;
}

type LongRunningRow = {
  node_id: string;
  node_name: string;
  minutes_open: number;
};

/**
 * Long-running irrigation check — the max-runtime cutoff replacement.
 *
 * Finds every OPEN irrigation cycle (ended_at IS NULL, not skipped) and, for
 * each one whose elapsed time has passed the node's effective
 * `irrigationMaxRunningMinutes`, files ONE `irrigation_long_running` warning
 * (deduped per node/type by createAlertIfNotExists — an open run never
 * re-alerts until the existing warning is acknowledged). It NEVER closes the
 * valve: closing is always a human action (manual Close), and scheduled runs
 * self-close via their own programmed duration.
 */
export async function runLongRunningIrrigationCheck(): Promise<number> {
  const openResult = await pool.query<LongRunningRow>(
    `
    SELECT l.node_id, n.name AS node_name,
           EXTRACT(EPOCH FROM (NOW() - l.started_at)) / 60 AS minutes_open
    FROM irrigation_logs l
    INNER JOIN nodes n ON n.id = l.node_id
    WHERE l.skipped = FALSE AND l.ended_at IS NULL
    ORDER BY l.started_at ASC
    `
  );

  if (openResult.rowCount === 0) return 0;

  let flagged = 0;

  for (const row of openResult.rows) {
    // Three-tier resolution per node (defaults < farm < node override).
    const { values } = await getEffectiveThresholds(row.node_id);
    const minutesOpen = Number(row.minutes_open);
    if (minutesOpen < values.irrigationMaxRunningMinutes) continue;

    const created = await createAlertIfNotExists(
      row.node_id,
      "irrigation_long_running",
      "warning",
      `Node "${row.node_name}" has been irrigating for over ${values.irrigationMaxRunningMinutes} minutes (${Math.round(minutesOpen)} min). Check for a stuck valve or forgotten shutoff.`,
      `${Math.round(minutesOpen)} min`
    );
    if (created.created) {
      flagged++;
      console.log(
        `[alert-engine] ⏱ ${row.node_id} irrigating ${Math.round(minutesOpen)} min ≥ threshold ${values.irrigationMaxRunningMinutes} min — warning filed (valve NOT closed)`
      );
    }
  }

  return flagged;
}
