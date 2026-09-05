import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import { polygonAreaHa } from "./geo";
import { getZoneStatusesByFarm } from "./zoneService";

export type FarmDto = {
  id: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
};

/** Tenant scope derived from the authenticated session (Part 10 ext). */
export interface FarmListScope {
  isStaff: boolean;
  orgId: string | null;
  /** A farmer's OWN farm — they see exactly this one farm, never their whole
   *  org (an org may own many farms). Null for staff/admin. */
  farmId: string | null;
}

export type DashboardStats = {
  /** Mean of the per-zone aggregate moistures; null when no zone reports data. */
  avgMoisture: number | null;
  activeNodes: number;
  totalNodes: number;
  waterUsedTodayL: number;
  openAlerts: number;
};

export type DashboardDto = {
  farm: FarmDto;
  stats: DashboardStats;
  zones: Awaited<ReturnType<typeof getZoneStatusesByFarm>>;
};

type FarmRow = {
  id: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
};

function toFarmDto(row: FarmRow): FarmDto {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}

export async function listFarms(
  scope: FarmListScope,
  requestedOrgId?: string
): Promise<FarmDto[]> {
  // A farmer sees ONLY their own farm — never the org's other farms.
  if (!scope.isStaff) {
    if (!scope.farmId) {
      throw new HttpError(403, "Your account is not linked to a farm");
    }
    const result = await pool.query<FarmRow>(
      `SELECT id, name, location, latitude::float AS latitude, longitude::float AS longitude
       FROM farms
       WHERE id = $1
       ORDER BY created_at ASC`,
      [scope.farmId]
    );
    return result.rows.map(toFarmDto);
  }

  // Platform staff (admin/technician): explicit-pick rule — they never receive
  // an unscoped list.
  if (!requestedOrgId) {
    throw new HttpError(
      400,
      "Platform admins must pass an explicit ?orgId=<uuid> to list a client's farms"
    );
  }

  const result = await pool.query<FarmRow>(
    `SELECT id, name, location, latitude::float AS latitude, longitude::float AS longitude
     FROM farms
     WHERE org_id = $1
     ORDER BY created_at ASC`,
    [requestedOrgId]
  );
  return result.rows.map(toFarmDto);
}

export async function getFarmById(farmId: string): Promise<FarmDto> {
  const result = await pool.query<FarmRow>(
    `SELECT id, name, location, latitude::float AS latitude, longitude::float AS longitude
     FROM farms WHERE id = $1`,
    [farmId]
  );
  if (result.rowCount === 0) {
    throw HttpError.notFound(`Farm ${farmId} not found`);
  }
  return toFarmDto(result.rows[0]);
}

// ── Part 11: farm administration & client onboarding shell ─────────────────

/** Farm geospatial payload for the GPS map page (VECTOR layer read). */
export interface FarmSpatial {
  farmId: string;
  name: string;
  boundaryGeojson: unknown;
  centerLat: number | null;
  centerLon: number | null;
  latitude: number | null;
  longitude: number | null;
  totalAreaHa: number | null;
}

/** Farm geospatial row from the DB. */
type FarmSpatialRow = {
  id: string;
  name: string;
  boundary_geojson: unknown;
  center_lat: number | null;
  center_lon: number | null;
  latitude: number | null;
  longitude: number | null;
  total_area_ha: number | null;
};

/** GET — read a farm's boundary + center for the map. Any authenticated role. */
export async function getFarmSpatial(farmId: string): Promise<FarmSpatial> {
  const result = await pool.query<FarmSpatialRow>(
    `SELECT id, name, boundary_geojson,
            center_lat, center_lon,
            latitude::float AS latitude, longitude::float AS longitude,
            total_area_ha
     FROM farms WHERE id = $1`,
    [farmId]
  );
  if (result.rowCount === 0) throw HttpError.notFound(`Farm ${farmId} not found`);
  const r = result.rows[0];
  return {
    farmId: r.id,
    name: r.name,
    boundaryGeojson: r.boundary_geojson ?? null,
    centerLat: r.center_lat,
    centerLon: r.center_lon,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    totalAreaHa: r.total_area_ha,
  };
}

export interface FarmBoundaryPatch {
  boundaryGeojson?: unknown;
  centerLat?: number | null;
  centerLon?: number | null;
  /**
   * Farm area in hectares, computed on the client with turf.js from the exact
   * drawn polygon and sent together with the boundary in the same save call.
   * The backend stores it directly (no recompute needed — the client has the
   * source polygon in hand at save time).
   */
  totalAreaHa?: number | null;
}

/** PATCH — persist a freshly drawn farm boundary (zones.edit — field ops). */
export async function updateFarmBoundary(
  farmId: string,
  patch: FarmBoundaryPatch
): Promise<FarmSpatial> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  if (patch.boundaryGeojson !== undefined) {
    sets.push(`boundary_geojson = ${push(JSON.stringify(patch.boundaryGeojson))}::jsonb`);
    // Store the area the client computed (turf.area on the exact polygon). The
    // client always sends it together with the boundary; backend recompute is
    // only a fallback so older/other callers that send a boundary alone still
    // get a truthful figure.
    const areaHa = patch.totalAreaHa ?? polygonAreaHa(patch.boundaryGeojson);
    if (areaHa != null && areaHa > 0) sets.push(`total_area_ha = ${push(areaHa)}`);
  }
  if (patch.totalAreaHa !== undefined && patch.boundaryGeojson === undefined) {
    sets.push(`total_area_ha = ${push(patch.totalAreaHa)}`);
  }
  if (patch.centerLat !== undefined) sets.push(`center_lat = ${push(patch.centerLat)}`);
  if (patch.centerLon !== undefined) sets.push(`center_lon = ${push(patch.centerLon)}`);
  if (sets.length === 0) {
    throw new HttpError(400, "Provide at least one field to update");
  }
  sets.push(`updated_at = NOW()`);

  const result = await pool.query<FarmSpatialRow>(
    `UPDATE farms SET ${sets.join(", ")} WHERE id = ${push(farmId)}
     RETURNING id, name, boundary_geojson,
               center_lat, center_lon,
               latitude::float AS latitude, longitude::float AS longitude,
               total_area_ha`,
    values
  );
  if (result.rowCount === 0) throw HttpError.notFound(`Farm ${farmId} not found`);
  const r = result.rows[0];
  return {
    farmId: r.id,
    name: r.name,
    boundaryGeojson: r.boundary_geojson ?? null,
    centerLat: r.center_lat,
    centerLon: r.center_lon,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    totalAreaHa: r.total_area_ha,
  };
}

export interface FarmPatch {
  name?: string;
  location?: string;
}

/** Farm-admin level edit of farm identity fields. */
export async function updateFarm(farmId: string, patch: FarmPatch): Promise<FarmDto> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  if (patch.name !== undefined) sets.push(`name = ${push(patch.name)}`);
  if (patch.location !== undefined) sets.push(`location = ${push(patch.location)}`);
  sets.push(`updated_at = NOW()`);

  const result = await pool.query<FarmRow>(
    `UPDATE farms SET ${sets.join(", ")} WHERE id = ${push(farmId)}
     RETURNING id, name, location, latitude::float AS latitude, longitude::float AS longitude`,
    values
  );
  if (result.rowCount === 0) throw HttpError.notFound(`Farm ${farmId} not found`);
  return toFarmDto(result.rows[0]);
}

export interface OrganizationWithFarms {
  id: string;
  name: string;
  farms: FarmDto[];
}

export async function listOrganizationsWithFarms(): Promise<OrganizationWithFarms[]> {
  const orgs = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations ORDER BY created_at ASC`
  );
  const farms = await pool.query<FarmRow & { org_id: string }>(
    `SELECT id, name, location, latitude::float AS latitude, longitude::float AS longitude, org_id
     FROM farms ORDER BY created_at ASC`
  );

  return orgs.rows.map((org) => ({
    id: org.id,
    name: org.name,
    farms: farms.rows.filter((f) => f.org_id === org.id).map(toFarmDto),
  }));
}

/**
 * Part 12 onboarding stub — creates a client organization plus its first
 * farm in one call. No invitations/billing/UI yet by design.
 */
export async function createOrganizationWithFarm(input: {
  name: string;
  farmName?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<{ organization: { id: string; name: string }; farm: FarmDto }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query<{ id: string; name: string }>(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING id, name`,
      [input.name]
    );
    const farm = await client.query<FarmRow>(
      `INSERT INTO farms (org_id, name, location, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, location, latitude::float AS latitude, longitude::float AS longitude`,
      [
        org.rows[0].id,
        input.farmName ?? `${input.name} — First Farm`,
        input.location ?? "",
        input.latitude ?? null,
        input.longitude ?? null,
      ]
    );
    await client.query("COMMIT");
    return {
      organization: org.rows[0],
      farm: toFarmDto(farm.rows[0]),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Add a farm to an EXISTING organization (Part 12 ext).
 * Validates that the org exists, then creates the farm with org_id = existing org.
 */
export async function addFarmToOrganization(input: {
  orgId: string;
  farmName: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<{ organization: { id: string; name: string }; farm: FarmDto }> {
  // First verify the org exists
  const orgCheck = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations WHERE id = $1`,
    [input.orgId]
  );
  if (orgCheck.rowCount === 0) {
    throw HttpError.notFound(`Organization ${input.orgId} not found`);
  }

  const farm = await pool.query<FarmRow>(
    `INSERT INTO farms (org_id, name, location, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, location, latitude::float AS latitude, longitude::float AS longitude`,
    [
      input.orgId,
      input.farmName,
      input.location ?? "",
      input.latitude ?? null,
      input.longitude ?? null,
    ]
  );

  return {
    organization: orgCheck.rows[0],
    farm: toFarmDto(farm.rows[0]),
  };
}

/**
 * Everything the dashboard hero needs in one call:
 * farm identity + headline stats + per-zone summaries.
 */
export async function getDashboard(farmId: string): Promise<DashboardDto> {
  const [farm, zones] = await Promise.all([
    getFarmById(farmId),
    getZoneStatusesByFarm(farmId),
  ]);

  const [nodeStats, waterToday, openAlerts] = await Promise.all([
    pool.query<{ active_count: number; total_count: number }>(
      `SELECT COALESCE(COUNT(*) FILTER (WHERE active AND status <> 'offline'), 0)::int AS active_count,
              COUNT(*) FILTER (WHERE active)::int AS total_count
       FROM nodes
       WHERE farm_id = $1`,
      [farmId]
    ),
    pool.query<{ litres: number }>(
      `SELECT COALESCE(SUM(water_used_litres) FILTER (WHERE skipped = FALSE), 0)::float AS litres
       FROM irrigation_logs
       WHERE started_at >= date_trunc('day', NOW())
         AND zone_id IN (SELECT id FROM zones WHERE farm_id = $1)`,
      [farmId]
    ),
    pool.query<{ open_alerts: number }>(
      `SELECT COUNT(*)::int AS open_alerts
       FROM alerts
       WHERE farm_id = $1 AND acknowledged_at IS NULL`,
      [farmId]
    ),
  ]);

  const moistureValues = zones
    .map((zone) => zone.moisture)
    .filter((m): m is number => m !== null);

  const avgMoisture =
    moistureValues.length > 0
      ? Math.round(
          (moistureValues.reduce((sum, m) => sum + m, 0) / moistureValues.length) * 10
        ) / 10
      : null;

  return {
    farm,
    stats: {
      avgMoisture,
      activeNodes: nodeStats.rows[0].active_count,
      totalNodes: nodeStats.rows[0].total_count,
      waterUsedTodayL: waterToday.rows[0].litres ?? 0,
      openAlerts: openAlerts.rows[0].open_alerts,
    },
    zones,
  };
}
