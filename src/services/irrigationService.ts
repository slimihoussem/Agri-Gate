import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import {
  CreateNodeScheduleInput,
  IrrigationLogDto,
  IrrigationScheduleDto,
  UpdateScheduleInput,
} from "../schemas/irrigation.schema";
import { fireIrrigation } from "../irrigation/scheduler";
import { publishIrrigationCommand } from "../irrigation/commandPublisher";
import type { AccessContext } from "../auth/authService";
import { assertFarmAccess } from "../auth/tenancy";

// ─── Shared row shapes & mappers ────────────────────────────────────────────

type ScheduleRow = {
  id: string;
  zone_id: string;
  zone_name: string;
  node_id: string | null;
  node_name: string | null;
  schedule_type: "recurring" | "one_time";
  start_time: string | null;
  duration_minutes: number;
  repeat_days: unknown;
  moisture_threshold: number | null;
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  fired_at: Date | null;
  active: boolean;
};

const SCHEDULE_SELECT = `
  SELECT s.id,
         s.zone_id,
         z.name AS zone_name,
         s.node_id,
         n.name AS node_name,
         s.schedule_type,
         s.start_time::text AS start_time,
         s.duration_minutes,
         s.repeat_days,
         s.moisture_threshold::float AS moisture_threshold,
         s.scheduled_start,
         s.scheduled_end,
         s.fired_at,
         s.active
  FROM irrigation_schedules s
  INNER JOIN zones z ON z.id = s.zone_id
  LEFT JOIN nodes n ON n.id = s.node_id`;

function toScheduleDto(row: ScheduleRow): IrrigationScheduleDto {
  return {
    id: row.id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    scheduleType: row.schedule_type,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    repeatDays: Array.isArray(row.repeat_days) ? row.repeat_days.map(Number) : [],
    moistureThreshold: row.moisture_threshold,
    scheduledStart: row.scheduled_start ? row.scheduled_start.toISOString() : null,
    scheduledEnd: row.scheduled_end ? row.scheduled_end.toISOString() : null,
    firedAt: row.fired_at ? row.fired_at.toISOString() : null,
    active: row.active,
  };
}

type LogRow = {
  id: string;
  zone_id: string;
  zone_name: string;
  node_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  skipped: boolean;
  skip_reason: string | null;
  water_used_l: number;
  triggered_by: string;
};

const LOG_SELECT = `
  SELECT l.id, l.zone_id, z.name AS zone_name, l.node_id, l.started_at, l.ended_at,
         l.skipped, l.skip_reason, l.water_used_litres::float AS water_used_l, l.triggered_by
  FROM irrigation_logs l
  INNER JOIN zones z ON z.id = l.zone_id`;

function toLogDto(row: LogRow): IrrigationLogDto {
  return {
    id: row.id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    nodeId: row.node_id,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    skipped: row.skipped,
    // Skip reasons are always returned inline — never hidden behind a click.
    skipReason: row.skip_reason,
    waterUsedL: row.water_used_l ?? 0,
    triggeredBy: row.triggered_by,
  };
}

// ─── Farm-scoped reads (history page) ───────────────────────────────────────

export async function getSchedulesByFarm(farmId: string): Promise<IrrigationScheduleDto[]> {
  const result = await pool.query<ScheduleRow>(
    `${SCHEDULE_SELECT} WHERE z.farm_id = $1 ORDER BY s.schedule_type ASC, COALESCE(s.scheduled_start, z.created_at) ASC, s.start_time ASC`,
    [farmId]
  );
  return result.rows.map(toScheduleDto);
}

export async function getLogsByFarm(farmId: string): Promise<IrrigationLogDto[]> {
  const result = await pool.query<LogRow>(
    `${LOG_SELECT} WHERE z.farm_id = $1 ORDER BY l.started_at DESC`,
    [farmId]
  );
  return result.rows.map(toLogDto);
}

/** Part 12 UI: one node's runs only (tenant-gated). */
export async function getLogsByNode(
  nodeId: string,
  ctx?: AccessContext
): Promise<IrrigationLogDto[]> {
  const node = await resolveNode(nodeId);
  await assertNodeAccess(ctx, node.farm_id, "node");
  const result = await pool.query<LogRow>(
    `${LOG_SELECT} WHERE l.node_id = $1 ORDER BY l.started_at DESC`,
    [nodeId]
  );
  return result.rows.map(toLogDto);
}

// ─── Node-scoped reads & creation (Part 9 ext) ──────────────────────────────

/** Resolves a node's tenancy + actuator/metering facts; throws 404 when unknown. */
async function resolveNode(nodeId: string): Promise<{
  id: string;
  name: string;
  farm_id: string;
  org_id: string;
  zone_id: string | null;
  zone_name: string;
  is_actuator: boolean;
  is_zone_valve: boolean;
  flow_rate_l_per_min: number | null;
  max_runtime_minutes: number | null;
}> {
  const result = await pool.query<{
    id: string;
    name: string;
    farm_id: string;
    org_id: string;
    zone_id: string | null;
    zone_name: string;
    is_actuator: boolean;
    is_zone_valve: boolean;
    flow_rate_l_per_min: number | null;
    max_runtime_minutes: number | null;
  }>(
    `
    SELECT n.id, n.name, n.farm_id, f.org_id, n.zone_id, z.name AS zone_name,
           n.is_actuator, n.is_zone_valve,
           n.flow_rate_l_per_min::real::float AS flow_rate_l_per_min,
           n.max_runtime_minutes
    FROM nodes n
    INNER JOIN farms f ON f.id = n.farm_id
    LEFT JOIN zones z ON z.id = n.zone_id
    WHERE n.id = $1
    `,
    [nodeId]
  );
  if (result.rowCount === 0) throw HttpError.notFound(`Node "${nodeId}" not found`);
  return result.rows[0];
}

async function assertNodeAccess(ctx: AccessContext | undefined, farmId: string, label: string): Promise<void> {
  if (ctx) await assertFarmAccess(ctx, farmId, label);
}

function requireActuator(node: { is_actuator: boolean; name: string }): void {
  if (!node.is_actuator) {
    throw new HttpError(
      400,
      `This node has no valve installed — irrigation control is unavailable.`
    );
  }
}

export async function getSchedulesByNode(
  nodeId: string,
  ctx?: AccessContext
): Promise<IrrigationScheduleDto[]> {
  const node = await resolveNode(nodeId);
  await assertNodeAccess(ctx, node.farm_id, "node");
  const result = await pool.query<ScheduleRow>(
    `${SCHEDULE_SELECT} WHERE s.node_id = $1 ORDER BY s.schedule_type ASC, COALESCE(s.scheduled_start, s.created_at) ASC, s.start_time ASC`,
    [nodeId]
  );
  return result.rows.map(toScheduleDto);
}

/** One-time duration = scheduled_end − scheduled_start, floored to whole minutes. */
export function oneTimeDurationMinutes(
  scheduledStart: Date,
  scheduledEnd: Date
): number {
  const ms = scheduledEnd.getTime() - scheduledStart.getTime();
  return Math.max(1, Math.round(ms / 60_000));
}

export async function createScheduleForNode(
  nodeId: string,
  input: CreateNodeScheduleInput
): Promise<IrrigationScheduleDto> {
  const node = await resolveNode(nodeId);
  requireActuator(node);
  if (!node.zone_id || !node.zone_name) {
    throw new HttpError(400, `Actuator node "${node.name}" is not assigned to a zone`);
  }

  if (input.scheduleType === "recurring") {
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO irrigation_schedules
            (zone_id, node_id, schedule_type, start_time, duration_minutes, repeat_days, moisture_threshold, active)
      VALUES ($1, $2, 'recurring', $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        node.zone_id,
        nodeId,
        input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime,
        input.durationMinutes,
        input.repeatDays,
        input.moistureThreshold,
        input.active,
      ]
    );

    const created = await pool.query<ScheduleRow>(
      `${SCHEDULE_SELECT} WHERE s.id = $1`,
      [inserted.rows[0].id]
    );
    return toScheduleDto(created.rows[0]);
  }

  // ── one_time branch ──────────────────────────────────────────────────────
  const scheduledStart = new Date(input.scheduledStart);
  const scheduledEnd = new Date(input.scheduledEnd);
  const duration = oneTimeDurationMinutes(scheduledStart, scheduledEnd);
  if (node.max_runtime_minutes !== null && duration > node.max_runtime_minutes) {
    throw new HttpError(
      400,
      `One-time run of ${duration} min exceeds node "${node.name}" max_runtime_minutes (${node.max_runtime_minutes})`
    );
  }

  const inserted = await pool.query<{ id: string }>(
    `
    INSERT INTO irrigation_schedules
          (zone_id, node_id, schedule_type, scheduled_start, scheduled_end, duration_minutes, moisture_threshold, active)
    VALUES ($1, $2, 'one_time', $3, $4, $5, $6, $7)
    RETURNING id
    `,
    [
      node.zone_id,
      nodeId,
      scheduledStart,
      scheduledEnd,
      duration,
      input.moistureThreshold ?? null,
      input.active,
    ]
  );

  const created = await pool.query<ScheduleRow>(
    `${SCHEDULE_SELECT} WHERE s.id = $1`,
    [inserted.rows[0].id]
  );
  return toScheduleDto(created.rows[0]);
}

// ─── Running state & immediate control (Part 9 ext) ─────────────────────────

export interface NodeIrrigationStatus {
  isRunning: boolean;
  currentLog: IrrigationLogDto | null;
}

/** Open run = latest row for this node with ended_at IS NULL AND skipped = FALSE. */
export async function getNodeIrrigationStatus(
  nodeId: string,
  ctx?: AccessContext
): Promise<NodeIrrigationStatus> {
  const node = await resolveNode(nodeId);
  await assertNodeAccess(ctx, node.farm_id, "node");
  const result = await pool.query<LogRow>(
    `${LOG_SELECT}
     WHERE l.node_id = $1 AND l.skipped = FALSE AND l.ended_at IS NULL
     ORDER BY l.started_at DESC
     LIMIT 1`,
    [nodeId]
  );
  if (result.rowCount === 0) return { isRunning: false, currentLog: null };
  return { isRunning: true, currentLog: toLogDto(result.rows[0]) };
}

/**
 * Immediate manual OPEN, independent of any schedule.
 * One open command at a time per node (409 on overlap). Publish failure
 * downgrades the just-created log to skipped=true with the delivery reason.
 *
 * durationMinutes is OPTIONAL and defaults to OPEN-ENDED: when omitted, no
 * duration is requested from the valve — it stays open until the operator
 * issues a Close (no auto/safety cutoff anywhere). `startScheduleNow` still
 * passes the schedule's own duration so manual-start-via-schedule keeps the
 * scheduled duration semantics.
 */
export async function startNodeIrrigation(
  nodeId: string,
  durationMinutes: number | undefined,
  triggeredByUserId: string,
  ctx?: AccessContext
): Promise<{ log: IrrigationLogDto; delivered: boolean; failureReason?: string }> {
  const node = await resolveNode(nodeId);
  requireActuator(node);
  if (!node.zone_id) {
    throw new HttpError(400, `Actuator node "${node.name}" is not assigned to a zone`);
  }
  await assertNodeAccess(ctx, node.farm_id, "node");

  const running = await getNodeIrrigationStatus(nodeId);
  if (running.isRunning) {
    throw new HttpError(
      409,
      `Node "${node.name}" already has an open irrigation cycle (log ${running.currentLog?.id}) — stop it first`
    );
  }

  const outcome = await fireIrrigation({
    zoneId: node.zone_id,
    nodeId: node.id,
    triggeredBy: triggeredByUserId,
    orgId: node.org_id,
    farmId: node.farm_id,
    durationMinutes,
  });

  const logRow = await pool.query<LogRow>(`${LOG_SELECT} WHERE l.id = $1`, [outcome.logId]);
  return {
    log: toLogDto(logRow.rows[0]),
    delivered: outcome.delivered,
    failureReason: outcome.failureReason,
  };
}

/**
 * Immediate manual CLOSE: publishes irrigate_stop, then closes the currently
 * open log row (ended_at = NOW(), water metered). If the publish fails the
 * run stays open so the operator can retry.
 */
export async function stopNodeIrrigation(
  nodeId: string,
  ctx?: AccessContext
): Promise<{ log: IrrigationLogDto; delivered: boolean; failureReason?: string }> {
  const node = await resolveNode(nodeId);
  requireActuator(node);
  await assertNodeAccess(ctx, node.farm_id, "node");

  const running = await getNodeIrrigationStatus(nodeId);
  if (!running.isRunning || !running.currentLog) {
    throw new HttpError(409, `Node "${node.name}" has no running irrigation cycle`);
  }
  const logId = running.currentLog.id;

  const result = await publishIrrigationCommand({
    nodeId,
    orgId: node.org_id,
    farmId: node.farm_id,
    action: "irrigate_stop",
    logId,
  });

  if (!result.delivered) {
    return { log: running.currentLog, delivered: false, failureReason: result.error };
  }

  await pool.query(
    `
    UPDATE irrigation_logs
    SET ended_at = NOW(),
        water_used_litres =
          CASE
            WHEN $2::real IS NULL THEN NULL  -- unmetered: visibly NULL, never guessed
            ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60.0) * $2::real
          END
    WHERE id = $1
    `,
    [logId, node.flow_rate_l_per_min]
  );
  if (node.flow_rate_l_per_min === null) {
    console.warn(
      `[irrigation] ⚠ node ${nodeId} has no flow_rate_l_per_min — run closed as UNMETERED (water_used_litres = NULL)`
    );
  }

  const closed = await pool.query<LogRow>(`${LOG_SELECT} WHERE l.id = $1`, [logId]);
  return { log: toLogDto(closed.rows[0]), delivered: true };
}

/**
 * Last-running-valve safety rule (regular FIELD-NODE actuators only — Part 19
 * zone valves are excluded here and governed by checkFarmZoneValveBlock).
 * blocked=true when THIS node is currently running AND no OTHER regular
 * field-node valve is open in the same zone. The router uses this to reject a
 * normal stop with `{ blocked: true, reason: "last_running_valve_in_zone",
 * zoneName }` unless an authorized technician/admin sends force=true (audited
 * as force_close_last_valve). A running zone valve in this zone does NOT count
 * toward other_running: the two valve families are completely independent.
 */
export async function checkLastRunningValveBlock(
  nodeId: string
): Promise<{ blocked: boolean; zoneName: string | null }> {
  const node = await resolveNode(nodeId);
  if (!node.is_actuator || !node.zone_id || node.is_zone_valve) {
    return { blocked: false, zoneName: null };
  }
  const result = await pool.query<{
    other_running: number;
    self_running: boolean;
    zone_name: string;
  }>(
    `
    SELECT
      (SELECT COUNT(*)::int
        FROM irrigation_logs other
        INNER JOIN nodes on2 ON on2.id = other.node_id
        WHERE other.zone_id = $1
          AND other.ended_at IS NULL
          AND other.skipped = FALSE
          AND other.node_id <> $2
          AND (on2.is_zone_valve IS NOT TRUE)
      ) AS other_running,
      EXISTS (
        SELECT 1 FROM irrigation_logs me
        WHERE me.zone_id = $1
          AND me.node_id = $2
          AND me.ended_at IS NULL
          AND me.skipped = FALSE
      ) AS self_running,
      z.name AS zone_name
    FROM zones z
    WHERE z.id = $1
    `,
    [node.zone_id, node.id]
  );
  const row = result.rows[0];
  return {
    blocked: row.self_running && row.other_running === 0,
    zoneName: row.zone_name,
  };
}

/**
 * Part 19: farm-level safety rule for ZONE VALVES. blocked=true when THIS zone
 * valve is currently running AND no OTHER zone valve on the ENTIRE FARM is
 * open. A farm must keep at least one zone valve open at all times, so closing
 * the last one requires an authorized technician/admin force=true (audited as
 * force_close_last_zone_valve).
 */
export async function checkFarmZoneValveBlock(
  farmId: string,
  nodeId: string
): Promise<{ blocked: boolean }> {
  const result = await pool.query<{ other_running: number; self_running: boolean }>(
    `
    SELECT
      (SELECT COUNT(*)::int
        FROM irrigation_logs other
        INNER JOIN nodes on2 ON on2.id = other.node_id
        WHERE on2.farm_id = $1
          AND (on2.is_zone_valve IS TRUE)
          AND other.skipped = FALSE
          AND other.ended_at IS NULL
          AND other.node_id <> $2
      ) AS other_running,
      EXISTS (
        SELECT 1 FROM irrigation_logs me
        WHERE me.node_id = $2
          AND me.skipped = FALSE
          AND me.ended_at IS NULL
      ) AS self_running
    `,
    [farmId, nodeId]
  );
  const row = result.rows[0];
  return { blocked: row.self_running && row.other_running === 0 };
}

// ─── Schedule edit (existing Part 9 route) ──────────────────────────────────

export async function updateSchedule(
  id: string,
  patch: UpdateScheduleInput,
  ctx?: AccessContext
): Promise<IrrigationScheduleDto> {
  // Tenant gate (Part 10 ext): resolve the schedule's owning farm first.
  let existing: { schedule_type: "recurring" | "one_time" } | null = null;
  if (ctx) {
    const owner = await pool.query<{ farm_id: string; schedule_type: "recurring" | "one_time" }>(
      `
      SELECT z.farm_id, s.schedule_type
      FROM irrigation_schedules s
      INNER JOIN zones z ON z.id = s.zone_id
      WHERE s.id = $1
      `,
      [id]
    );
    if (owner.rowCount === 0) {
      throw HttpError.notFound(`Irrigation schedule ${id} not found`);
    }
    existing = { schedule_type: owner.rows[0].schedule_type };
    await assertFarmAccess(ctx, owner.rows[0].farm_id, "irrigation schedule");
  } else {
    const probe = await pool.query<{ schedule_type: "recurring" | "one_time" }>(
      `SELECT schedule_type FROM irrigation_schedules WHERE id = $1`,
      [id]
    );
    if (probe.rowCount === 0) throw HttpError.notFound(`Irrigation schedule ${id} not found`);
    existing = probe.rows[0];
  }

  const isOneTime = existing.schedule_type === "one_time";
  const isOneTimePatch = patch.scheduledStart !== undefined || patch.scheduledEnd !== undefined;

  if (isOneTime && (patch.startTime !== undefined || patch.repeatDays !== undefined)) {
    throw new HttpError(
      400,
      `Schedule ${id} is one_time — recurring fields (startTime/repeatDays) are not applicable`
    );
  }
  if (!isOneTime && isOneTimePatch) {
    throw new HttpError(
      400,
      `Schedule ${id} is recurring — one_time fields (scheduledStart/scheduledEnd) are not applicable`
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (isOneTime) {
    if (isOneTimePatch) {
      const cur = await pool.query<{ scheduled_start: Date; scheduled_end: Date }>(
        `SELECT scheduled_start, scheduled_end FROM irrigation_schedules WHERE id = $1`,
        [id]
      );
      const start = patch.scheduledStart ? new Date(patch.scheduledStart) : new Date(cur.rows[0].scheduled_start);
      const end = patch.scheduledEnd ? new Date(patch.scheduledEnd) : new Date(cur.rows[0].scheduled_end);
      if (end.getTime() <= start.getTime()) {
        throw new HttpError(400, "scheduledEnd must be after scheduledStart");
      }
      const duration = oneTimeDurationMinutes(start, end);
      sets.push(`scheduled_start = ${push(start)}`);
      sets.push(`scheduled_end = ${push(end)}`);
      sets.push(`duration_minutes = ${push(duration)}`);
      sets.push(`fired_at = ${push(null)}`); // retiming resets the fired stamp
    }
  } else {
    if (patch.startTime !== undefined) {
      sets.push(`start_time = ${push(normalizeTimeOfDay(patch.startTime))}`);
    }
    if (patch.durationMinutes !== undefined) {
      sets.push(`duration_minutes = ${push(patch.durationMinutes)}`);
    }
    if (patch.repeatDays !== undefined) {
      sets.push(`repeat_days = ${push(patch.repeatDays)}`);
    }
  }
  if (patch.moistureThreshold !== undefined) {
    sets.push(`moisture_threshold = ${push(patch.moistureThreshold)}`);
  }
  if (patch.active !== undefined) {
    sets.push(`active = ${push(patch.active)}`);
  }
  sets.push(`updated_at = NOW()`);

  const result = await pool.query<ScheduleRow>(
    `
    UPDATE irrigation_schedules
    SET ${sets.join(", ")}
    WHERE id = ${push(id)}
    RETURNING id, zone_id,
              (SELECT z.name FROM zones z WHERE z.id = irrigation_schedules.zone_id) AS zone_name,
              node_id,
              (SELECT n.name FROM nodes n WHERE n.id = irrigation_schedules.node_id) AS node_name,
              schedule_type,
              start_time::text AS start_time,
              duration_minutes, repeat_days,
              moisture_threshold::float AS moisture_threshold,
              scheduled_start, scheduled_end, fired_at,
              active
    `,
    values
  );
  if (result.rowCount === 0) {
    throw HttpError.notFound(`Irrigation schedule ${id} not found`);
  }
  return toScheduleDto(result.rows[0]);
}

/** Part 017: resolve a schedule's owning farm (audit trail); 404 when unknown. */
export async function getScheduleFarmId(id: string, ctx?: AccessContext): Promise<string> {
  const result = await pool.query<{ farm_id: string }>(
    `
    SELECT z.farm_id
    FROM irrigation_schedules s
    INNER JOIN zones z ON z.id = s.zone_id
    WHERE s.id = $1
    `,
    [id]
  );
  if (result.rowCount === 0) throw HttpError.notFound(`Irrigation schedule ${id} not found`);
  if (ctx) await assertFarmAccess(ctx, result.rows[0].farm_id, "irrigation schedule");
  return result.rows[0].farm_id;
}

/** Part 017: remove a schedule entirely (audited at the route layer). */
export async function deleteSchedule(
  id: string,
  ctx?: AccessContext
): Promise<void> {
  if (ctx) {
    const owner = await pool.query<{ farm_id: string }>(
      `
      SELECT z.farm_id
      FROM irrigation_schedules s
      INNER JOIN zones z ON z.id = s.zone_id
      WHERE s.id = $1
      `,
      [id]
    );
    if (owner.rowCount === 0) {
      throw HttpError.notFound(`Irrigation schedule ${id} not found`);
    }
    await assertFarmAccess(ctx, owner.rows[0].farm_id, "irrigation schedule");
  }
  const result = await pool.query(`DELETE FROM irrigation_schedules WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    throw HttpError.notFound(`Irrigation schedule ${id} not found`);
  }
}

/** Accepts "HH:MM" or "HH:MM:SS", stores full TIME. */
function normalizeTimeOfDay(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

// ─── Manual start via schedule (kept for API compatibility) ─────────────────

export interface StartIrrigationResult extends IrrigationLogDto {
  commandDelivered: boolean;
  failureReason?: string;
}

/**
 * POST /api/irrigation/schedules/:id/start — fires THIS SCHEDULE'S node.
 * Bypasses the moisture threshold (explicit operator request). Failure to
 * deliver downgrades the log to skipped=true and is reported back.
 */
export async function startScheduleNow(
  scheduleId: string,
  triggeredByUserId?: string,
  ctx?: AccessContext
): Promise<StartIrrigationResult> {
  const scheduleResult = await pool.query<{
    id: string;
    node_id: string | null;
    zone_id: string;
    zone_name: string;
    duration_minutes: number;
    farm_id: string;
    org_id: string;
  }>(
    `
    SELECT s.id, s.node_id, s.zone_id, z.name AS zone_name, s.duration_minutes, z.farm_id, f.org_id
    FROM irrigation_schedules s
    INNER JOIN zones z ON z.id = s.zone_id
    INNER JOIN farms f ON f.id = z.farm_id
    WHERE s.id = $1
    `,
    [scheduleId]
  );
  if (scheduleResult.rowCount === 0) {
    throw HttpError.notFound(`Irrigation schedule ${scheduleId} not found`);
  }
  const schedule = scheduleResult.rows[0];

  // Tenant gate (Part 10 ext).
  if (ctx) {
    await assertFarmAccess(ctx, schedule.farm_id, "irrigation schedule");
  }

  // Target: the schedule's own node; fall back to the zone's designated
  // actuator for any pre-migration row that never got one.
  let targetNodeId = schedule.node_id;
  if (!targetNodeId) {
    const fallback = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM nodes WHERE zone_id = $1 AND is_actuator = TRUE LIMIT 1`,
      [schedule.zone_id]
    );
    if (fallback.rowCount === 0) {
      throw new HttpError(
        400,
        `Schedule has no node and zone "${schedule.zone_name}" has no actuator node configured`
      );
    }
    targetNodeId = fallback.rows[0].id;
  }

  const outcome = await startNodeIrrigation(
    targetNodeId,
    schedule.duration_minutes,
    triggeredByUserId ?? "manual",
    ctx
  );

  return {
    ...outcome.log,
    commandDelivered: outcome.delivered,
    failureReason: outcome.failureReason,
  };
}
