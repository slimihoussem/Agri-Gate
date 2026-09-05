import { pool } from "../db/pool";
import { getZoneMoistures } from "../services/zoneService";
import { publishIrrigationCommand } from "./commandPublisher";

/**
 * Automated irrigation scheduler — Part 9 (per-node granularity extension).
 *
 * Ticks once per minute, ALIGNED to minute boundaries (+2s padding):
 *   1. find ACTIVE schedules whose start_time == current local HH:MM and
 *      whose repeat_days include today's day-of-week,
 *   2. double-fire guard (in-memory set cleared each minute),
 *   3. moisture gate still uses the SCHEDULE'S ZONE aggregate (node → zone),
 *      computed by the shared zoneService query,
 *   4. fire-or-skip targets THIS schedule's specific node.
 *
 * Rows without a valid actuator node (legacy backfill gaps) are excluded by
 * the INNER JOIN and therefore never fire — see migration 0009 notice.
 */

const TICK_PADDING_MS = 2_000;
const MINUTE_MS = 60_000;

export function startIrrigationScheduler(): NodeJS.Timeout {
  let stopped = false;

  const scheduleNext = (): void => {
    if (stopped) return;
    const now = Date.now();
    const delayToNextMinute = MINUTE_MS - (now % MINUTE_MS) + TICK_PADDING_MS;
    const timer = setTimeout(() => {
      void tick()
        .catch((err) => console.error("[scheduler] 💥 tick failed:", err))
        .finally(scheduleNext);
    }, delayToNextMinute);
    timer.unref?.();
  };

  console.log("[scheduler] irrigation scheduler started (per-node) — ticking every minute");
  scheduleNext();

  return setTimeout(() => undefined, 0);
}

type DueScheduleRow = {
  id: string;
  node_id: string;
  node_name: string;
  zone_id: string;
  zone_name: string;
  farm_id: string;
  org_id: string;
  duration_minutes: number;
  moisture_threshold: number;
};

type DueOneTimeRow = {
  id: string;
  node_id: string;
  node_name: string;
  zone_id: string;
  zone_name: string;
  farm_id: string;
  org_id: string;
  scheduled_start: Date;
  scheduled_end: Date;
  moisture_threshold: number | null;
};

let firedThisMinute = new Set<string>();
let currentMinuteKey = "";

async function tick(): Promise<void> {
  const now = new Date();
  const nowKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  if (nowKey !== currentMinuteKey) {
    firedThisMinute = new Set();
    currentMinuteKey = nowKey;
  }

  // Wall-clock semantics: recurring schedules express the FARMER'S local
  // time-of-day (server timezone), not the database container's UTC.
  const hhmmss = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}:00`;
  const dayOfWeek = now.getDay();

  const due = await pool.query<DueScheduleRow>(
    `
    SELECT s.id, s.node_id, n.name AS node_name, n.zone_id,
           z.name AS zone_name, z.farm_id, f.org_id,
           s.duration_minutes, s.moisture_threshold::float AS moisture_threshold
    FROM irrigation_schedules s
    INNER JOIN nodes n ON n.id = s.node_id AND n.is_actuator = TRUE
    INNER JOIN zones z ON z.id = n.zone_id
    INNER JOIN farms f ON f.id = z.farm_id
    WHERE s.schedule_type = 'recurring'
      AND s.active = TRUE
      AND s.start_time = $1::time
      AND $2::int = ANY(s.repeat_days)
    `,
    [hhmmss, dayOfWeek]
  );

  const dueOneTime = await pool.query<DueOneTimeRow>(
    `
    SELECT s.id, s.node_id, n.name AS node_name, n.zone_id,
           z.name AS zone_name, z.farm_id, f.org_id,
           s.scheduled_start, s.scheduled_end,
           s.moisture_threshold::float AS moisture_threshold
    FROM irrigation_schedules s
    INNER JOIN nodes n ON n.id = s.node_id AND n.is_actuator = TRUE
    INNER JOIN zones z ON z.id = n.zone_id
    INNER JOIN farms f ON f.id = z.farm_id
    WHERE s.schedule_type = 'one_time'
      AND s.active = TRUE
      AND s.fired_at IS NULL
      AND s.scheduled_start <= NOW()
    `,
    []
  );

  const schedules = due.rows.filter((s) => {
    if (firedThisMinute.has(s.id)) return false;
    firedThisMinute.add(s.id);
    return true;
  });
  const oneTimes = dueOneTime.rows.filter((s) => {
    if (firedThisMinute.has(s.id)) return false;
    firedThisMinute.add(s.id);
    return true;
  });
  if (schedules.length === 0 && oneTimes.length === 0) return;

  // Moisture gate STILL uses the ZONE aggregate (node → its zone), shared query.
  const moistures = await getZoneMoistures(
    [...schedules, ...oneTimes].map((s) => s.zone_id)
  );

  for (const schedule of schedules) {
    await processDueSchedule(schedule, moistures.get(schedule.zone_id) ?? null);
  }
  for (const schedule of oneTimes) {
    await processDueOneTime(schedule, moistures.get(schedule.zone_id) ?? null);
  }
}

async function processDueSchedule(
  schedule: DueScheduleRow,
  moisture: number | null
): Promise<void> {
  console.log(
    `[scheduler] ⏰ schedule ${schedule.id} due → node ${schedule.node_id} ("${schedule.zone_name}") — zone moisture ${moisture ?? "N/A"}%, threshold ${schedule.moisture_threshold}%`
  );

  // ── Safety gate: never actuate blind ─────────────────────────────────────
  if (moisture === null) {
    await insertSkippedLog(
      schedule.zone_id,
      "No recent sensor data for this zone — refusing to irrigate without live moisture readings",
      "schedule",
      schedule.node_id
    );
    console.warn(`[scheduler] ⚠ skipped "${schedule.node_name}": no live zone moisture`);
    return;
  }

  // ── Skip path: soil already wet enough ───────────────────────────────────
  if (moisture >= schedule.moisture_threshold) {
    await insertSkippedLog(
      schedule.zone_id,
      `Soil moisture (${moisture}%) at or above threshold (${schedule.moisture_threshold}%)`,
      "schedule",
      schedule.node_id
    );
    console.log(
      `[scheduler] ↷ skipped "${schedule.node_name}" — zone moisture ${moisture}% ≥ threshold ${schedule.moisture_threshold}%`
    );
    return;
  }

  // ── Fire path: this specific node ────────────────────────────────────────
  const outcome = await fireIrrigation({
    zoneId: schedule.zone_id,
    nodeId: schedule.node_id,
    triggeredBy: "schedule",
    orgId: schedule.org_id,
    farmId: schedule.farm_id,
    durationMinutes: schedule.duration_minutes,
  });

  if (outcome.delivered) {
    console.log(
      `[scheduler] 💧 fired schedule for node ${schedule.node_id} ("${schedule.zone_name}") — ${schedule.duration_minutes} min (log ${outcome.logId})`
    );
  }
}

/**
 * One-time dated schedule (Part 017): fires ONCE at scheduled_start.
 * Duration = scheduled_end − scheduled_start. fired_at ALWAYS gets stamped
 * after processing — a skipped one-time run is NOT retried next minute.
 */
async function processDueOneTime(
  schedule: DueOneTimeRow,
  moisture: number | null
): Promise<void> {
  const duration = Math.max(
    1,
    Math.round((schedule.scheduled_end.getTime() - schedule.scheduled_start.getTime()) / 60_000)
  );
  console.log(
    `[scheduler] ⏰ one-time schedule ${schedule.id} due → node ${schedule.node_id} ("${schedule.zone_name}") — ${duration} min`
  );

  // ── actuator-conflict guard: never stack a second open run ───────────────
  const running = await pool.query<{ id: string }>(
    `
    SELECT id FROM irrigation_logs
    WHERE node_id = $1 AND skipped = FALSE AND ended_at IS NULL
    LIMIT 1
    `,
    [schedule.node_id]
  );
  if ((running.rowCount ?? 0) > 0) {
    await insertSkippedLog(
      schedule.zone_id,
      `Node "${schedule.node_name}" already has an irrigation cycle running — one-time run skipped`,
      "schedule",
      schedule.node_id
    );
    console.warn(`[scheduler] ⚠ skipped one-time "${schedule.node_name}": actuator already running`);
    await pool.query(`UPDATE irrigation_schedules SET fired_at = NOW() WHERE id = $1`, [
      schedule.id,
    ]);
    return;
  }

  // ── moisture gate: threshold NULL (or no-data) behaves like recurring ────
  let skipReason: string | null = null;
  if (moisture === null) {
    skipReason =
      "No recent sensor data for this zone — refusing to irrigate without live moisture readings";
  } else if (schedule.moisture_threshold !== null && moisture >= schedule.moisture_threshold) {
    skipReason = `Soil moisture (${moisture}%) at or above threshold (${schedule.moisture_threshold}%)`;
  }

  if (skipReason) {
    await insertSkippedLog(schedule.zone_id, skipReason, "schedule", schedule.node_id);
    console.log(
      `[scheduler] ↷ skipped one-time "${schedule.node_name}" — ${skipReason}`
    );
    await pool.query(`UPDATE irrigation_schedules SET fired_at = NOW() WHERE id = $1`, [
      schedule.id,
    ]);
    return;
  }

  const outcome = await fireIrrigation({
    zoneId: schedule.zone_id,
    nodeId: schedule.node_id,
    triggeredBy: "schedule",
    orgId: schedule.org_id,
    farmId: schedule.farm_id,
    durationMinutes: duration,
  });
  await pool.query(`UPDATE irrigation_schedules SET fired_at = NOW() WHERE id = $1`, [
    schedule.id,
  ]);
  if (outcome.delivered) {
    console.log(
      `[scheduler] 💧 fired one-time run for node ${schedule.node_id} ("${schedule.zone_name}") — ${duration} min (log ${outcome.logId})`
    );
  }
}

// ── shared persistence used by scheduler + manual control ───────────────────

export async function insertSkippedLog(
  zoneId: string,
  skipReason: string,
  triggeredBy: string,
  nodeId?: string
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO irrigation_logs (zone_id, node_id, started_at, ended_at, skipped, skip_reason, water_used_litres, triggered_by)
    VALUES ($1, $2, NOW(), NOW(), TRUE, $3, 0, $4)
    RETURNING id
    `,
    [zoneId, nodeId ?? null, skipReason, triggeredBy]
  );
  return result.rows[0].id;
}

/**
 * Inserts an OPEN log row first (ended_at NULL until completion/stop) to get
 * a logId, publishes the MQTT start command to THIS node, and on delivery
 * failure downgrades that same row to skipped=true + ended_at=NOW() — a log
 * must never claim irrigation ran when the command never left the server.
 *
 * durationMinutes is OPTIONAL: when omitted the MQTT payload carries no
 * duration, so the device keeps the valve open until it receives an
 * `irrigate_stop` (manual Open). Scheduler-fired runs always supply a
 * duration so the device self-closes after the scheduled minutes.
 */
export async function fireIrrigation(params: {
  zoneId: string;
  nodeId: string;
  triggeredBy: string;
  orgId: string;
  farmId: string;
  durationMinutes?: number;
}): Promise<{ logId: string; delivered: boolean; failureReason?: string }> {
  const insert = await pool.query<{ id: string }>(
    `
    INSERT INTO irrigation_logs (zone_id, node_id, started_at, ended_at, skipped, skip_reason, water_used_litres, triggered_by)
    VALUES ($1, $2, NOW(), NULL, FALSE, NULL, 0, $3)
    RETURNING id
    `,
    [params.zoneId, params.nodeId, params.triggeredBy]
  );
  const logId = insert.rows[0].id;

  const result = await publishIrrigationCommand({
    nodeId: params.nodeId,
    orgId: params.orgId,
    farmId: params.farmId,
    action: "irrigate_start",
    durationMinutes: params.durationMinutes,
    logId,
  });

  if (!result.delivered) {
    await pool.query(
      `
      UPDATE irrigation_logs
      SET skipped = TRUE, skip_reason = $2, ended_at = NOW()
      WHERE id = $1
      `,
      [logId, result.error ?? "Command delivery failed — broker unreachable"]
    );
    console.error(
      `[scheduler] ✗ irrigation for node ${params.nodeId} NOT delivered (${result.error}) — log ${logId} marked skipped`
    );
    return { logId, delivered: false, failureReason: result.error };
  }

  return { logId, delivered: true };
}
