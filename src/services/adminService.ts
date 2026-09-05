import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";

/**
 * Platform-admin console queries — Part 12 ext.
 *
 * The ONLY place allowed to return unscoped cross-tenant data, and even here
 * strictly aggregate COUNTs (never per-record rows). Everything else in the
 * API remains tenant-scoped.
 */

export interface PlatformOverview {
  totalOrgs: number;
  totalFarms: number;
  totalNodes: number;
  totalActiveNodes: number;
  totalOpenCriticalAlerts: number;
  totalOpenAlerts: number;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const result = await pool.query<PlatformOverview>(
    `
    SELECT
      (SELECT COUNT(*)::int FROM organizations)                                          AS "totalOrgs",
      (SELECT COUNT(*)::int FROM farms)                                                  AS "totalFarms",
      (SELECT COUNT(*)::int FROM nodes WHERE active)                                       AS "totalNodes",
      (SELECT COUNT(*)::int FROM nodes WHERE active AND status <> 'offline')               AS "totalActiveNodes",
      (SELECT COUNT(*)::int FROM alerts WHERE acknowledged_at IS NULL AND severity = 'critical') AS "totalOpenCriticalAlerts",
      (SELECT COUNT(*)::int FROM alerts WHERE acknowledged_at IS NULL)                   AS "totalOpenAlerts"
    `
  );
  return result.rows[0];
}

export interface OrgFarmStats {
  farmId: string;
  farmName: string;
  nodeCount: number;
  activeNodeCount: number;
  openAlertCount: number;
}

export interface OrgWithFarmStats {
  orgId: string;
  orgName: string;
  farms: OrgFarmStats[];
}

export async function listOrgsWithFarmStats(includeInactive = false): Promise<OrgWithFarmStats[]> {
  const orgs = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations ORDER BY created_at ASC`
  );
  const activeFilter = includeInactive ? "" : " AND f.active";
  const farms = await pool.query<{
    org_id: string;
    farm_id: string;
    name: string;
    node_count: number;
    active_node_count: number;
    open_alert_count: number;
  }>(
    `
    SELECT f.org_id, f.id AS farm_id, f.name,
           (SELECT COUNT(*)::int FROM nodes WHERE nodes.farm_id = f.id AND nodes.active)                                  AS node_count,
           (SELECT COUNT(*)::int FROM nodes WHERE nodes.farm_id = f.id AND nodes.active AND nodes.status <> 'offline')    AS active_node_count,
           (SELECT COUNT(*)::int FROM alerts a WHERE a.farm_id = f.id AND a.acknowledged_at IS NULL)       AS open_alert_count
    FROM farms f
    WHERE TRUE${activeFilter}
    ORDER BY f.created_at ASC
    `
  );

  return orgs.rows.map((org) => ({
    orgId: org.id,
    orgName: org.name,
    farms: farms.rows
      .filter((f) => f.org_id === org.id)
      .map((f) => ({
        farmId: f.farm_id,
        farmName: f.name,
        nodeCount: f.node_count,
        activeNodeCount: f.active_node_count,
        openAlertCount: f.open_alert_count,
      })),
  }));
}

// ── Part 12 ext: farm edit / remove / add-to-existing-org ───────────────────

export interface FarmPatch {
  name?: string;
  orgId?: string;
  centerLat?: number | null;
  centerLon?: number | null;
  totalAreaHa?: number | null;
  active?: boolean;
}

export async function updateFarmAdmin(
  farmId: string,
  patch: FarmPatch
): Promise<{ reassigned: boolean; oldOrgId: string | null; newOrgId: string | null }> {
  // Resolve current state first (for reassignment detection).
  const current = await pool.query<{ org_id: string; name: string }>(
    `SELECT org_id, name FROM farms WHERE id = $1`,
    [farmId]
  );
  if ((current.rowCount ?? 0) === 0) {
    throw new Error(`Farm ${farmId} not found`);
  }
  const oldOrgId = current.rows[0].org_id;

  if (patch.orgId !== undefined && patch.orgId !== oldOrgId) {
    // Validate target org exists.
    const orgCheck = await pool.query(`SELECT 1 FROM organizations WHERE id = $1`, [patch.orgId]);
    if ((orgCheck.rowCount ?? 0) === 0) {
      throw new Error(`Target organization ${patch.orgId} does not exist`);
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown): string => { values.push(v); return `$${values.length}`; };

  if (patch.name !== undefined) sets.push(`name = ${push(patch.name)}`);
  if (patch.orgId !== undefined && patch.orgId !== oldOrgId) sets.push(`org_id = ${push(patch.orgId)}`);
  if (patch.centerLat !== undefined) sets.push(`latitude = ${push(patch.centerLat)}`);
  if (patch.centerLon !== undefined) sets.push(`longitude = ${push(patch.centerLon)}`);
  if (patch.totalAreaHa !== undefined) sets.push(`total_area_ha = ${push(patch.totalAreaHa)}`);
  if (patch.active !== undefined) sets.push(`active = ${push(patch.active)}`);
  sets.push(`updated_at = NOW()`);

  await pool.query(
    `UPDATE farms SET ${sets.join(", ")} WHERE id = ${push(farmId)}`,
    values
  );

  const reassigned = patch.orgId !== undefined && patch.orgId !== oldOrgId;
  return {
    reassigned,
    oldOrgId: reassigned ? oldOrgId : null,
    newOrgId: reassigned ? (patch.orgId ?? null) : null,
  };
}

export interface FarmDeleteResult {
  deleted: true;
  mode: "hard" | "archived";
  zoneCount?: number;
  nodeCount?: number;
  userCount?: number;
}

export async function deleteFarmWithLifecycle(farmId: string): Promise<FarmDeleteResult> {
  // Check if farm exists.
  const exists = await pool.query(`SELECT 1 FROM farms WHERE id = $1`, [farmId]);
  if ((exists.rowCount ?? 0) === 0) throw new Error(`Farm ${farmId} not found`);

  // Count dependent records.
  const counts = await pool.query<{
    zone_count: number;
    node_count: number;
    user_count: number;
  }>(
    `
    SELECT
      (SELECT COUNT(*)::int FROM zones WHERE zones.farm_id = $1)                    AS zone_count,
      (SELECT COUNT(*)::int FROM nodes WHERE nodes.farm_id = $1)                    AS node_count,
      (SELECT COUNT(*)::int FROM users WHERE users.org_id = (SELECT org_id FROM farms WHERE id = $1)) AS user_count
    `,
    [farmId]
  );

  const { zone_count: zoneCount, node_count: nodeCount, user_count: userCount } =
    counts.rows[0];

  if (zoneCount > 0 || nodeCount > 0 || userCount > 1) {
    // Archive — preserve all history.
    await pool.query(
      `UPDATE farms SET active = FALSE, updated_at = NOW() WHERE id = $1`,
      [farmId]
    );
    return { deleted: true, mode: "archived", zoneCount, nodeCount, userCount };
  }

  // Genuinely empty farm — hard delete. Drop its audit trail first: the
  // ONLY non-cascading FK into farms is staff_actions_log.farm_id (NO ACTION).
  await pool.query(`DELETE FROM staff_actions_log WHERE farm_id = $1`, [farmId]);
  await pool.query(`DELETE FROM farms WHERE id = $1`, [farmId]);
  return { deleted: true, mode: "hard" };
}

export async function addFarmToExistingOrg(
  orgId: string,
  input: { name: string; centerLat?: number; centerLon?: number; totalAreaHa?: number }
): Promise<{ id: string; name: string }> {
  // Validate org exists.
  const orgCheck = await pool.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgId]);
  if ((orgCheck.rowCount ?? 0) === 0) throw new Error(`Organization ${orgId} not found`);
  const result = await pool.query<{ id: string; name: string }>(
    `
    INSERT INTO farms (org_id, name, location, center_lat, center_lon, total_area_ha)
    VALUES ($1, $2, '', $3, $4, $5)
    RETURNING id, name
    `,
    [orgId, input.name, input.centerLat ?? null, input.centerLon ?? null, input.totalAreaHa ?? null]
  );
  return result.rows[0];
}

/**
 * Remove an organization ONLY when it is genuinely empty:
 *  - any farm (active OR archived) → 400 with the blocking count
 *  - any attached user account → 400 (prevents accidental data loss)
 *  - otherwise hard delete the org row.
 */
export async function deleteOrgWithGuards(
  orgId: string
): Promise<{ deleted: true; farmCount: number; userCount: number }> {
  const org = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations WHERE id = $1`,
    [orgId]
  );
  if ((org.rowCount ?? 0) === 0) throw HttpError.notFound(`Organization ${orgId} not found`);

  const farmRes = await pool.query(`SELECT COUNT(*)::int AS c FROM farms WHERE org_id = $1`, [orgId]);
  const farmCount = Number(farmRes.rows[0].c);
  if (farmCount > 0) {
    throw new HttpError(
      400,
      `Organization "${org.rows[0].name}" has ${farmCount} farm(s) — remove or reassign them before deleting the organization.`
    );
  }

  const userRes = await pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE org_id = $1`, [orgId]);
  const userCount = Number(userRes.rows[0].c);
  if (userCount > 0) {
    throw new HttpError(
      400,
      `Organization "${org.rows[0].name}" still has ${userCount} user account(s) — remove them before deleting.`
    );
  }

  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  return { deleted: true, farmCount, userCount };
}

