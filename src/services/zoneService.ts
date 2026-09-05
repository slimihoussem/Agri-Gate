import { pool } from "../db/pool";
import { ZoneStatus, ZoneSummary } from "../schemas/zone.schema";

/**
 * ─── SINGLE SOURCE OF TRUTH: zone moisture status thresholds ───────────────
 * moisture < target - 20  → "critical"
 * moisture < target - 10  → "warning"
 * else                    → "ok"
 *
 * null moisture (0 active nodes, or active nodes that have not reported yet)
 * → "disconnected". A dead sensor is NOT the same as dry soil and must never
 * collapse into ok/warning/critical.
 *
 * The frontend only renders whatever status this returns — thresholds must
 * NOT be duplicated anywhere else in backend or frontend.
 */
export function computeZoneStatus(
  moisture: number | null,
  targetMoisture: number
): ZoneStatus {
  if (moisture === null || Number.isNaN(moisture)) {
    return "disconnected";
  }
  if (moisture < targetMoisture - 20) return "critical";
  if (moisture < targetMoisture - 10) return "warning";
  return "ok";
}

type ZoneAggregateRow = {
  id: string;
  name: string;
  crop_type: string;
  target_moisture: number;
  active: boolean;
  moisture: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  active_node_count: number | null;
  active_schedule_count: number | null;
  node_count: number | null;
  active_actuator_count: number | null;
  last_watered: Date | null;
  boundary_gps: unknown;
  area_hectares: number | null;
  has_zone_valve: number | null;
  zone_valve_running: boolean;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

function toZoneSummary(row: ZoneAggregateRow): ZoneSummary {
  // Round AFTER averaging; status is computed from the rounded display value
  // so UI numbers and status always agree.
  const moisture = row.moisture === null ? null : round1(row.moisture);
  return {
    id: row.id,
    name: row.name,
    cropType: row.crop_type,
    targetMoisture: row.target_moisture,
    moisture,
    nitrogen: row.nitrogen === null ? null : round1(row.nitrogen),
    phosphorus: row.phosphorus === null ? null : round1(row.phosphorus),
    potassium: row.potassium === null ? null : round1(row.potassium),
    status: computeZoneStatus(moisture, row.target_moisture),
    active: row.active,
    activeNodeCount: row.active_node_count ?? 0,
    activeScheduleCount: row.active_schedule_count ?? 0,
    nodeCount: row.node_count ?? 0,
    activeActuatorCount: row.active_actuator_count ?? 0,
    // Part 19: dedicated main-valve node — presence + live open state.
    hasZoneValve: (row.has_zone_valve ?? 0) > 0,
    zoneValveRunning: row.zone_valve_running === true,
    // Raw ISO 8601 — "2h ago" formatting is a frontend concern.
    lastWatered: row.last_watered ? row.last_watered.toISOString() : null,
    boundaryGps: row.boundary_gps ?? null,
    // Stored area (auto-calculated/backfilled) — shown on the Farm Map legend,
    // popup and header. Single source; never re-derived on the client.
    areaHectares: row.area_hectares,
  };
}

/**
 * Shared aggregate query — SINGLE SOURCE for "latest reading per active node,
 * averaged per zone". Used by:
 *   - GET /api/farms/:farmId/zones + dashboard (by farm)
 *   - Part 9 irrigation scheduler (by explicit zone ids, moisture gate)
 * Never duplicate the DISTINCT-ON logic elsewhere.
 */
async function queryZoneAggregates(
  scope: { farmId: string; includeInactive?: boolean } | { zoneIds: string[] }
): Promise<ZoneAggregateRow[]> {
  let whereClause: string;
  let param: unknown;
  if ("farmId" in scope) {
    whereClause = scope.includeInactive
      ? `WHERE z.farm_id = $1`
      : `WHERE z.farm_id = $1 AND z.active`;
    param = scope.farmId;
  } else {
    whereClause = `WHERE z.id = ANY($1::uuid[])`;
    param = scope.zoneIds;
  }

  const result = await pool.query<ZoneAggregateRow>(
    `
    WITH latest AS (
      -- Part 13 ext: a node contributes ONLY to fields its
      -- sensor_capabilities include (CASE → NULL → excluded from AVG).
      SELECT DISTINCT ON (t.node_id)
             t.node_id, t.zone_id,
             CASE WHEN n.sensor_capabilities ? 'soilMoisture'  THEN t.soil_moisture END AS soil_moisture,
             CASE WHEN n.sensor_capabilities ? 'nitrogen'      THEN t.nitrogen      END AS nitrogen,
             CASE WHEN n.sensor_capabilities ? 'phosphorus'    THEN t.phosphorus    END AS phosphorus,
             CASE WHEN n.sensor_capabilities ? 'potassium'     THEN t.potassium     END AS potassium,
             CASE WHEN n.sensor_capabilities ? 'soilTemp'      THEN t.soil_temp     END AS soil_temp_probe,
             CASE WHEN n.sensor_capabilities ? 'airTemp'       THEN t.air_temp      END AS air_probe,
             CASE WHEN n.sensor_capabilities ? 'airHumidity'   THEN t.humidity      END AS humidity_probe
      FROM telemetry t
      INNER JOIN nodes n ON n.id = t.node_id
      WHERE n.zone_id IS NOT NULL
        AND n.active
        AND n.status <> 'offline'
      ORDER BY t.node_id, t.time DESC
    ),
    per_zone AS (
      SELECT zone_id,
             COUNT(soil_moisture)::int AS active_node_count,
             AVG(soil_moisture)::float AS moisture,
             AVG(nitrogen)::float      AS nitrogen,
             AVG(phosphorus)::float    AS phosphorus,
             AVG(potassium)::float     AS potassium
      FROM latest
      GROUP BY zone_id
    ),
    last_water AS (
      SELECT il.zone_id, MAX(il.started_at) AS last_watered
      FROM irrigation_logs il
      WHERE il.skipped = FALSE
      GROUP BY il.zone_id
    )
    SELECT z.id,
           z.name,
           z.crop_type,
           z.target_moisture::float AS target_moisture,
           z.active,
           z.boundary_gps,
           z.area_hectares::float,
           pz.active_node_count,
           pz.moisture,
           pz.nitrogen,
           pz.phosphorus,
           pz.potassium,
           lw.last_watered,
            (SELECT COUNT(*)::int
             FROM irrigation_schedules s
             INNER JOIN nodes n ON n.id = s.node_id
             WHERE n.zone_id = z.id AND s.active) AS active_schedule_count,
           (SELECT COUNT(*)::int FROM nodes zn
            WHERE zn.zone_id = z.id AND zn.active) AS node_count,
           (SELECT COUNT(*)::int FROM nodes zn2
            WHERE zn2.zone_id = z.id AND zn2.active AND zn2.is_actuator) AS active_actuator_count,
           -- Part 19: zone valve presence (one per zone) + whether it is
           -- currently open (open run on the valve itself, not a field node).
           (SELECT COUNT(*)::int FROM nodes zv
            WHERE zv.zone_id = z.id AND zv.is_zone_valve) AS has_zone_valve,
           EXISTS (
             SELECT 1 FROM irrigation_logs zl
             INNER JOIN nodes zv ON zv.id = zl.node_id
             WHERE zv.zone_id = z.id
               AND (zv.is_zone_valve IS TRUE)
               AND zl.skipped = FALSE
               AND zl.ended_at IS NULL
           ) AS zone_valve_running
    FROM zones z
    LEFT JOIN per_zone pz ON pz.zone_id = z.id
    LEFT JOIN last_water lw ON lw.zone_id = z.id
    ${whereClause}
    ORDER BY z.created_at ASC, z.name ASC
    `,
    [param]
  );
  return result.rows;
}

/** Current average moisture per zone id — scheduler's fire-or-skip input. */
export async function getZoneMoistures(
  zoneIds: string[]
): Promise<Map<string, number | null>> {
  if (zoneIds.length === 0) return new Map();
  const rows = await queryZoneAggregates({ zoneIds });
  return new Map(rows.map((row) => [row.id, row.moisture === null ? null : round1(row.moisture)]));
}

export async function getZoneStatusesByFarm(
  farmId: string,
  includeInactive = false
): Promise<ZoneSummary[]> {
  const rows = await queryZoneAggregates({ farmId, includeInactive });
  return rows.map(toZoneSummary);
}
