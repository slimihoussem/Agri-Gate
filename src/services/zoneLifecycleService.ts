import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import { polygonAreaHa } from "./geo";

/**
 * Zone lifecycle management — Part 13 ext.
 * Create / edit / archive-or-delete, with node-count safety and history
 * preservation rules enforced server-side.
 */

export interface ZoneCreateInfo {
  name: string;
  cropType: string;
  targetMoisture: number;
  soilType?: string;
  areaHectares?: number;
  boundaryGps?: unknown;
}

export interface ZonePatch {
  name?: string;
  cropType?: string;
  targetMoisture?: number;
  soilType?: string;
  areaHectares?: number;
  boundaryGps?: unknown;
  active?: boolean;
}

export type ZoneDeleteMode = "hard" | "archived";

export interface ZoneInfo {
  id: string;
  name: string;
  cropType: string;
  targetMoisture: number;
  farmId: string;
  active: boolean;
  activeScheduleCount: number;
  nodeCount: number;
}

/** GET /api/zones/:zoneId payload (identity + counts + lifecycle flag). */
export async function getZoneInfo(zoneId: string): Promise<ZoneInfo | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    crop_type: string;
    target_moisture: number;
    farm_id: string;
    active: boolean;
    active_schedule_count: number;
    node_count: number;
  }>(
    `
    SELECT z.id, z.name, z.crop_type, z.target_moisture::float AS target_moisture,
           z.farm_id, z.active,
           (SELECT COUNT(*)::int FROM irrigation_schedules s
            INNER JOIN nodes n ON n.id = s.node_id
            WHERE n.zone_id = z.id AND s.active) AS active_schedule_count,
           (SELECT COUNT(*)::int FROM nodes WHERE nodes.zone_id = z.id AND nodes.active) AS node_count
    FROM zones z WHERE z.id = $1
    `,
    [zoneId]
  );
  if (result.rowCount === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    name: r.name,
    cropType: r.crop_type,
    targetMoisture: r.target_moisture,
    farmId: r.farm_id,
    active: r.active,
    activeScheduleCount: r.active_schedule_count,
    nodeCount: r.node_count,
  };
}

export async function getZoneFarmId(zoneId: string): Promise<string | null> {
  const result = await pool.query<{ farm_id: string }>(
    `SELECT farm_id FROM zones WHERE id = $1`,
    [zoneId]
  );
  return result.rowCount === 0 ? null : result.rows[0].farm_id;
}

export async function createZone(farmId: string, input: ZoneCreateInfo): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO zones (farm_id, name, crop_type, target_moisture, soil_type, area_hectares, boundary_gps)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    RETURNING id
    `,
    [
      farmId,
      input.name,
      input.cropType,
      input.targetMoisture,
      input.soilType ?? null,
      input.areaHectares ?? null,
      input.boundaryGps ? JSON.stringify(input.boundaryGps) : null,
    ]
  );
  return result.rows[0].id;
}

export async function updateZone(zoneId: string, patch: ZonePatch): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  if (patch.name !== undefined) sets.push(`name = ${push(patch.name)}`);
  if (patch.cropType !== undefined) sets.push(`crop_type = ${push(patch.cropType)}`);
  if (patch.targetMoisture !== undefined) sets.push(`target_moisture = ${push(patch.targetMoisture)}`);
  if (patch.soilType !== undefined) sets.push(`soil_type = ${push(patch.soilType)}`);
  if (patch.active !== undefined) sets.push(`active = ${push(patch.active)}`);

  if (patch.boundaryGps !== undefined) {
    sets.push(`boundary_gps = ${push(JSON.stringify(patch.boundaryGps))}::jsonb`);
    // Store the area the client computed (turf.area on the exact polygon).
    // Backend recompute is only a fallback for callers that send a boundary
    // alone — manual area entry is otherwise overridden to stay truthful to
    // the real GPS footprint. The area is pushed HERE (single column write)
    // so a caller that includes BOTH boundaryGps and areaHectares does not
    // trigger a "multiple assignments to same column" 42601 error.
    const areaHa = patch.areaHectares ?? polygonAreaHa(patch.boundaryGps);
    if (areaHa != null && areaHa >= 0) sets.push(`area_hectares = ${push(areaHa)}`);
  } else if (patch.areaHectares !== undefined) {
    sets.push(`area_hectares = ${push(patch.areaHectares)}`);
  }

  if (sets.length === 0) {
    throw new HttpError(400, "Provide at least one field to update");
  }
  sets.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE zones SET ${sets.join(", ")} WHERE id = $${values.length + 1}`,
    [...values, zoneId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw HttpError.notFound(`Zone ${zoneId} not found`);
  }
}

/**
 * Delete-with-lifecycle:
 *   active nodes assigned    → 400 (reassign/remove first; NEVER cascade)
 *   archived-only nodes      → detached on hard delete (zone_id = NULL)
 *   no history (logs/alerts) → hard delete
 *   old logs/alerts present  → archive (active=false), records preserved
 *
 * Only ACTIVE nodes block zone removal — archived nodes are detached (unassigned)
 * so the zone can be removed even if it still has archived nodes, and those
 * detached nodes can no longer be reactivated against a gone zone.
 */
export async function deleteZoneWithLifecycle(
  zoneId: string
): Promise<{ deleted: true; mode: ZoneDeleteMode }> {
  const nodeCount = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM nodes WHERE zone_id = $1 AND active`,
    [zoneId]
  );
  const nodes = nodeCount.rows[0]?.count ?? 0;
  if (nodes > 0) {
    throw new HttpError(
      400,
      `Zone has ${nodes} active node(s) assigned — reassign, remove, or archive them before deleting this zone.`
    );
  }

  const zoneExists = await getZoneInfo(zoneId);
  if (!zoneExists) throw HttpError.notFound(`Zone ${zoneId} not found`);

  const history = await pool.query<{ count: number }>(
    `
    SELECT (SELECT COUNT(*)::int FROM irrigation_logs WHERE zone_id = $1)
         + (SELECT COUNT(*)::int FROM alerts WHERE zone_id = $1) AS count
    `,
    [zoneId]
  );
  const historyCount = history.rows[0]?.count ?? 0;

  if (historyCount > 0) {
    await pool.query(`UPDATE zones SET active = FALSE, updated_at = NOW() WHERE id = $1`, [zoneId]);
    return { deleted: true, mode: "archived" };
  }

  // Hard delete: detach any archived nodes so nothing references a removed zone.
  await pool.query(
    `UPDATE nodes SET zone_id = NULL, updated_at = NOW() WHERE zone_id = $1 AND NOT active`,
    [zoneId]
  );

  const deleted = await pool.query(`DELETE FROM zones WHERE id = $1`, [zoneId]);
  if ((deleted.rowCount ?? 0) === 0) throw HttpError.notFound(`Zone ${zoneId} not found`);
  return { deleted: true, mode: "hard" };
}
