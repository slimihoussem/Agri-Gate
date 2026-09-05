import { randomUUID } from "crypto";
import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import { polygonContains, gpsToXY, polygonBBox, autoPlacePointInside } from "./geo";
import { CreateNodeInput, NodeDto } from "../schemas/node.schema";
import type { AccessContext } from "../auth/authService";
import { assertFarmAccess } from "../auth/tenancy";

const NODE_SELECT = `
  SELECT n.id,
         n.farm_id,
         n.zone_id,
         z.name AS zone_name,
         n.name,
         n.comm_method,
         n.mqtt_client_id AS "mqttClientId",
         n.status,
         n.map_x::float AS x,
         n.map_y::float AS y,
         n.battery::float AS battery,
         n.rssi,
         n.last_seen_at,
         n.read_interval_ms AS "readIntervalMs",
         n.is_actuator AS "isActuator",
         n.is_zone_valve AS "isZoneValve",
         n.active,
         n.lat::float AS lat,
         n.lon::float AS lon,
         n.sensor_capabilities AS "sensorCapabilities",
         n.flow_rate_l_per_min::real::float AS "flowRateLPerMin",
         n.max_runtime_minutes AS "maxRuntimeMinutes",
         n.installed_at,
         n.notes,
         lt.moisture,
         lt.soil_temp AS "soilTemp",
         lt.air_temp AS "ambientTemp",
         lt.humidity
  FROM nodes n
  LEFT JOIN zones z ON z.id = n.zone_id
  LEFT JOIN LATERAL (
    SELECT t.soil_moisture::float AS moisture,
           t.soil_temp::float AS soil_temp,
           t.air_temp::float AS air_temp,
           t.humidity::float AS humidity
    FROM telemetry t
    WHERE t.node_id = n.id
    ORDER BY t.time DESC
    LIMIT 1
  ) lt ON TRUE`;

type NodeRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  zone_name: string | null;
  name: string;
  comm_method: string;
  mqttClientId: string | null;
  status: string;
  x: number | null;
  y: number | null;
  battery: number | null;
  rssi: number | null;
  last_seen_at: Date | null;
  readIntervalMs: number | null;
  isActuator: boolean;
  isZoneValve: boolean;
  active: boolean;
  lat: number | null;
  lon: number | null;
  sensorCapabilities: unknown;
  flowRateLPerMin: number | null;
  maxRuntimeMinutes: number | null;
  installed_at: Date | null;
  notes: string | null;
  moisture: number | null;
  soilTemp: number | null;
  ambientTemp: number | null;
  humidity: number | null;
};

function toNodeDto(row: NodeRow): NodeDto {
  return {
    id: row.id,
    farmId: row.farm_id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    name: row.name,
    commMethod: row.comm_method as NodeDto["commMethod"],
    mqttClientId: row.mqttClientId,
    status: row.status as NodeDto["status"],
    x: row.x,
    y: row.y,
    battery: row.battery,
    rssi: row.rssi,
    lastSeen: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    readIntervalMs: row.readIntervalMs ?? null,
    isActuator: row.isActuator,
    isZoneValve: row.isZoneValve,
    active: row.active,
    lat: row.lat,
    lon: row.lon,
    sensorCapabilities: Array.isArray(row.sensorCapabilities)
      ? (row.sensorCapabilities as NodeDto["sensorCapabilities"])
      : ["soilMoisture"],
    flowRateLPerMin: row.flowRateLPerMin,
    maxRuntimeMinutes: row.maxRuntimeMinutes,
    installedAt: row.installed_at ? row.installed_at.toISOString() : null,
    notes: row.notes,
    moisture: row.moisture,
    soilTemp: row.soilTemp,
    ambientTemp: row.ambientTemp,
    humidity: row.humidity,
  };
}

export async function getNodesByFarm(
  farmId: string,
  includeInactive = false
): Promise<NodeDto[]> {
  const filter = includeInactive ? "" : " AND n.active";
  const result = await pool.query<NodeRow>(
    `${NODE_SELECT} WHERE n.farm_id = $1${filter} ORDER BY n.id ASC`,
    [farmId]
  );
  return result.rows.map(toNodeDto);
}

/** Zone-expand UI: every sensor/actuator node inside one zone. */
export async function getNodesByZone(
  zoneId: string,
  includeInactive = false
): Promise<NodeDto[]> {
  const filter = includeInactive ? "" : " AND n.active";
  const result = await pool.query<NodeRow>(
    `${NODE_SELECT} WHERE n.zone_id = $1${filter} ORDER BY n.id ASC`,
    [zoneId]
  );
  return result.rows.map(toNodeDto);
}

export async function getNodeById(nodeId: string): Promise<NodeDto> {
  const result = await pool.query<NodeRow>(`${NODE_SELECT} WHERE n.id = $1`, [nodeId]);
  if (result.rowCount === 0) {
    throw HttpError.notFound(`Node "${nodeId}" not found`);
  }
  return toNodeDto(result.rows[0]);
}

/**
 * Registers a new sensor node. A freshly registered node has NO battery /
 * rssi / last_seen values yet (null until first telemetry arrives) — the
 * frontend must render an explicit empty state, never a fake 0%.
 */
export async function createNode(input: CreateNodeInput): Promise<NodeDto> {
  if (input.zoneId) {
    const zoneCheck = await pool.query<{ farm_id: string }>(
      `SELECT farm_id FROM zones WHERE id = $1`,
      [input.zoneId]
    );
    if (zoneCheck.rowCount === 0) {
      throw new HttpError(400, `Zone ${input.zoneId} does not exist`);
    }
    if (zoneCheck.rows[0].farm_id !== input.farmId) {
      throw new HttpError(400, "zoneId does not belong to farmId");
    }
  }

  // ── Part 19: zone valve specifics ─────────────────────────────────────────
  // A zone valve is one dedicated main-valve node per zone: forced actuator,
  // NO sensor capabilities, must be tied to a zone, and at most one per zone.
  const isZoneValve = input.isZoneValve === true;
  if (isZoneValve) {
    if (!input.zoneId) {
      throw new HttpError(400, "A zone valve must be assigned to a zone (zoneId is required)");
    }
    // Archived (soft-deleted) valves recede — only an ACTIVE valve occupies
    // the slot. Mirrors the partial unique index.
    const existingValve = await pool.query(
      `SELECT 1 FROM nodes WHERE zone_id = $1 AND is_zone_valve = TRUE AND active = TRUE LIMIT 1`,
      [input.zoneId]
    );
    if ((existingValve.rowCount ?? 0) > 0) {
      throw new HttpError(
        409,
        `This zone already has a main valve — remove it first to configure a new one`
      );
    }
  }
  input.isActuator = isZoneValve ? true : input.isActuator;
  input.sensorCapabilities = isZoneValve ? [] : input.sensorCapabilities;

  if (input.id) {
    const duplicate = await pool.query(`SELECT 1 FROM nodes WHERE id = $1`, [input.id]);
    if ((duplicate.rowCount ?? 0) > 0) {
      throw new HttpError(409, `Node "${input.id}" already exists`);
    }
  }

  if (input.mqttClientId) {
    const dup = await pool.query(`SELECT 1 FROM nodes WHERE mqtt_client_id = $1`, [
      input.mqttClientId,
    ]);
    if ((dup.rowCount ?? 0) > 0) {
      throw new HttpError(409, `MQTT client id "${input.mqttClientId}" is already in use`);
    }
  }

  const id = input.id ?? generateNodeId();
  let inserted: { id: string };
  try {
    const result = await pool.query<{ id: string }>(
      `
      INSERT INTO nodes (id, farm_id, zone_id, name, comm_method, status, map_x, map_y,
                         lat, lon, sensor_capabilities, mqtt_client_id, flow_rate_l_per_min,
                         max_runtime_minutes, installed_at, notes, is_actuator, is_zone_valve)
      VALUES ($1, $2, $3, $4, $5, 'online', $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id
      `,
      [
        id,
        input.farmId,
        input.zoneId ?? null,
        input.name,
        input.commMethod,
        input.mapX ?? null,
        input.mapY ?? null,
        input.lat ?? null,
        input.lon ?? null,
        JSON.stringify(input.sensorCapabilities ?? ["soilMoisture"]),
        input.mqttClientId ?? null,
        input.flowRateLPerMin ?? null,
        input.maxRuntimeMinutes ?? null,
        input.installedAt ?? null,
        input.notes ?? null,
        input.isActuator ?? false,
        isZoneValve,
      ]
    );
    inserted = result.rows[0];
  } catch (err) {
    // Concurrent create of a second zone valve for the same zone — convert the
    // raw partial-unique-index violation into the same friendly 409 the
    // pre-check returns.
    if (
      (err as { code?: string; constraint?: string }).code === "23505" &&
      (err as { constraint?: string }).constraint === "idx_one_zone_valve_per_zone"
    ) {
      throw new HttpError(
        409,
        `This zone already has a main valve — remove it first to configure a new one`
      );
    }
    throw err;
  }

  // ── Auto-placement on create ─────────────────────────────────────────
  // A node registered into a zone with a DRAWN boundary and no explicit GPS
  // is placed inside that zone (server-side mirror of the Farm Map's
  // boundary-save logic). A boundary-less zone leaves the position null — a
  // valid state filled later when the boundary is drawn.
  if (input.lat === undefined && input.lon === undefined && input.zoneId) {
    const placed = await placedPointForNode(input.zoneId);
    if (placed) {
      await pool.query(
        `UPDATE nodes SET lat = $1, lon = $2, updated_at = NOW() WHERE id = $3`,
        [placed.lat, placed.lon, id]
      );
    }
  }

  return getNodeById(id);
}

/**
 * Part 14: FULL node edit (name, zone, comm method, mqtt client id,
 * read interval, is_actuator, map position + all Part 13 ext fields).
 *
 * Rules enforced here (application-level, deliberate):
 *  - new zoneId must belong to the node's farm
 *  - mqttClientId duplicates → 409 (friendly, not a raw pg error)
 *  - disabling is_actuator while active schedules exist → 400
 *  - flowRateLPerMin / maxRuntimeMinutes only on actuators → 400
 *  - maxRuntimeMinutes below shortest existing schedule duration → 400
 */
export async function updateNodeExtended(
  nodeId: string,
  patch: {
    name?: string;
    zoneId?: string | null;
    commMethod?: string;
    mqttClientId?: string;
    readIntervalMs?: number | null;
    isActuator?: boolean;
    // DEPRECATED — legacy 0-100 placeholder position, superseded by lat/lon.
    mapX?: number;
    mapY?: number;
    lat?: number;
    lon?: number;
    sensorCapabilities?: string[];
    flowRateLPerMin?: number;
    maxRuntimeMinutes?: number;
    installedAt?: string;
    notes?: string;
    active?: boolean;
  },
  ctx?: AccessContext
): Promise<NodeDto> {
  const current = await resolveNodeRow(nodeId); // throws 404
  await assertNodeAccess(ctx, current.farm_id, "node");

  // ── zone move: target zone must belong to the same farm ────────────────
  if (patch.zoneId !== undefined && patch.zoneId !== null) {
    const zone = await pool.query<{ farm_id: string }>(
      `SELECT farm_id FROM zones WHERE id = $1`,
      [patch.zoneId]
    );
    if (zone.rowCount === 0) throw HttpError.notFound(`Zone ${patch.zoneId} not found`);
    if (zone.rows[0].farm_id !== current.farm_id) {
      throw new HttpError(400, "zoneId belongs to a different farm than this node");
    }
  }

  // ── Auto-placement on zone (re)assignment ─────────────────────────────
  // Server-side mirror of the Farm Map's boundary-save placement, invoked
  // when zoneId is being set or CHANGED. Rules:
  //   • the caller did NOT supply a genuinely new GPS position (an explicit
  //     lat/lon wins; the edit modal re-sends the node's own unchanged stored
  //     values, which must NOT suppress repositioning)
  //   • the zone actually changed, or the node has no GPS yet
  //   • the target zone has a drawn boundary → place inside it
  //   • boundary-less target zone → leave the node's position as-is
  // Computed BEFORE the SET is built so a placed point replaces (never
  // duplicates) a patch-supplied unchanged lat/lon.
  let autoPlaced: { lat: number; lon: number } | null = null;
  if (
    patch.zoneId !== undefined &&
    patch.zoneId !== null &&
    (patch.zoneId !== current.zone_id ||
      (current.lat === null && current.lon === null)) &&
    !(
      (patch.lat !== undefined && patch.lat !== current.lat) ||
      (patch.lon !== undefined && patch.lon !== current.lon)
    )
  ) {
    autoPlaced = await placedPointForNode(patch.zoneId);
  }

  // ── mqttClientId uniqueness → friendly 409 ──────────────────────────────
  if (patch.mqttClientId !== undefined) {
    const dup = await pool.query(
      `SELECT 1 FROM nodes WHERE mqtt_client_id = $1 AND id <> $2`,
      [patch.mqttClientId, nodeId]
    );
    if ((dup.rowCount ?? 0) > 0) {
      throw new HttpError(409, `MQTT client id "${patch.mqttClientId}" is already used by another node`);
    }
  }

  // ── actuator toggle-off guard: active schedules block it ───────────────
  const turningOff =
    patch.isActuator === false && current.is_actuator;
  if (turningOff) {
    const sched = await pool.query(
      `SELECT 1 FROM irrigation_schedules WHERE node_id = $1 AND active = TRUE LIMIT 1`,
      [nodeId]
    );
    if ((sched.rowCount ?? 0) > 0) {
      throw new HttpError(
        400,
        "Cannot disable actuator mode while active irrigation schedules target this node — remove or reassign them first"
      );
    }
  }

  // ── HARD SAFETY: a populated zone must always keep ≥1 active actuator ────
  // Applies to the three PATCH directions that could remove a zone's last
  // active valve. Only the LAST active actuator is protected.
  //   (a) toggling actuator mode OFF
  //   (b) moving an ACTIVE actuator to a DIFFERENT zone (leaves source zone)
  //   (c) deactivating (active → false) an ACTIVE actuator
  const newZoneId = patch.zoneId !== undefined ? patch.zoneId : current.zone_id;

  const lastActuatorLeaves =
    // (a) turning the actuator off
    (patch.isActuator === false && current.is_actuator) ||
    // (b) an active actuator being moved out of its current zone
    (patch.zoneId !== undefined &&
      patch.zoneId !== current.zone_id &&
      current.is_actuator &&
      current.active) ||
    // (c) an active actuator being deactivated
    (patch.active === false && current.active && current.is_actuator);

  if (lastActuatorLeaves && (patch.zoneId !== undefined ? newZoneId : current.zone_id)) {
    if (
      await wouldLeaveZoneWithoutActuator(current.zone_id, {
        excludingNodeId: nodeId,
        newIsActuatorValue: false,
      })
    ) {
      throw new HttpError(400, await lastActuatorGuardMessage(current.zone_id));
    }
  }

  // ── actuator-only fields → 400, based on the POST-patch actuator state ──
  // (is_actuator may be flipped in this same PATCH — a sensor being promoted
  //  to valve driver must be able to carry flowRate/maxRuntime along).
  const willBeActuator = patch.isActuator ?? current.is_actuator;
  if (!willBeActuator) {
    for (const field of ["flowRateLPerMin", "maxRuntimeMinutes"] as const) {
      if (patch[field] !== undefined) {
        throw new HttpError(400, `${field} applies to actuator nodes only`);
      }
    }
  }

  // ── safety cutoff vs scheduled runs ─────────────────────────────────────
  if (patch.maxRuntimeMinutes !== undefined) {
    const minSched = await pool.query<{ min_duration: number | null }>(
      `SELECT MIN(duration_minutes)::int AS min_duration FROM irrigation_schedules WHERE node_id = $1`,
      [nodeId]
    );
    const shortest = minSched.rows[0]?.min_duration ?? null;
    if (shortest !== null && patch.maxRuntimeMinutes < shortest) {
      throw new HttpError(
        400,
        `maxRuntimeMinutes (${patch.maxRuntimeMinutes}) is shorter than this node's shortest scheduled run (${shortest} min) — unsafe safety cutoff`
      );
    }
  }

  // ── build dynamic SET ───────────────────────────────────────────────────
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  if (patch.name !== undefined) sets.push(`name = ${push(patch.name)}`);
  if (patch.zoneId !== undefined) sets.push(`zone_id = ${push(patch.zoneId)}`);
  if (patch.commMethod !== undefined) sets.push(`comm_method = ${push(patch.commMethod)}`);
  if (patch.mqttClientId !== undefined) sets.push(`mqtt_client_id = ${push(patch.mqttClientId)}`);
  if (patch.readIntervalMs !== undefined) sets.push(`read_interval_ms = ${push(patch.readIntervalMs)}`);
  if (patch.isActuator !== undefined) sets.push(`is_actuator = ${push(patch.isActuator)}`);
  if (patch.mapX !== undefined) sets.push(`map_x = ${push(patch.mapX)}`);
  if (patch.mapY !== undefined) sets.push(`map_y = ${push(patch.mapY)}`);
  // A patch-supplied lat/lon that was auto-placement-suppressed (unchanged
  // stored values re-sent with the zone edit) must not be written twice.
  if (patch.lat !== undefined && !autoPlaced) sets.push(`lat = ${push(patch.lat)}`);
  if (patch.lon !== undefined && !autoPlaced) sets.push(`lon = ${push(patch.lon)}`);
  if (patch.sensorCapabilities !== undefined) {
    if (patch.sensorCapabilities.length === 0) {
      throw new HttpError(400, "sensorCapabilities cannot be empty — a node must report at least one sensor");
    }
    sets.push(`sensor_capabilities = ${push(JSON.stringify(patch.sensorCapabilities))}::jsonb`);
  }
  if (patch.flowRateLPerMin !== undefined) sets.push(`flow_rate_l_per_min = ${push(patch.flowRateLPerMin)}`);
  if (patch.maxRuntimeMinutes !== undefined) sets.push(`max_runtime_minutes = ${push(patch.maxRuntimeMinutes)}`);
  if (patch.installedAt !== undefined) sets.push(`installed_at = ${push(patch.installedAt)}::timestamptz`);
  if (patch.notes !== undefined) sets.push(`notes = ${push(patch.notes)}`);
  if (patch.active !== undefined) sets.push(`active = ${push(patch.active)}`);

  // ── GPS auto-derivation (real GPS → zone + on-map x/y %) ───────────────
  // When a node's GPS is set/moved (map reposition), derive:
  //   • containing zone via point-in-polygon (unless a zone was explicit)
  //   • on-map x/y % relative to the farm boundary bbox (unless explicit)
  //
  // NOTE: map_x/map_y are DEPRECATED — legacy 0-100 placeholder coordinates
  // from the retired static SVG map, fully superseded by real GPS (lat/lon).
  // The columns are kept for now (no migration); we still auto-maintain them
  // from GPS so any legacy reader keeps getting sane values, but no frontend
  // code reads or writes them anymore.
  const { lon, lat } = resolveNodeLonLat(patch, current);
  if (lon !== null && lat !== null) {
    if (patch.zoneId === undefined && patch.lat !== undefined && patch.lon !== undefined) {
      const detected = await detectContainingZone(current.farm_id, lon, lat);
      if (detected) sets.push(`zone_id = ${push(detected)}`);
    }
    if (!autoPlaced && patch.mapX === undefined && patch.mapY === undefined && patch.lat !== undefined && patch.lon !== undefined) {
      const bbox = await farmBoundaryBBox(current.farm_id);
      const xy = gpsToXY(lon, lat, bbox);
      if (xy) {
        sets.push(`map_x = ${push(xy.x)}`);
        sets.push(`map_y = ${push(xy.y)}`);
      }
    }
  }

  // Apply the auto-placement point (zone (re)assignment in a drawn boundary).
  if (autoPlaced) {
    sets.push(`lat = ${push(autoPlaced.lat)}`);
    sets.push(`lon = ${push(autoPlaced.lon)}`);
  }

  if (sets.length > 0) {
    const idPlaceholder = `$${values.length + 1}`;
    await pool.query(
      `UPDATE nodes SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ${idPlaceholder}`,
      [...values, nodeId]
    );
  }

  return getNodeById(nodeId);
}

/** Combine an incoming lon/lat patch with the stored values (null = none). */
function resolveNodeLonLat(
  patch: { lon?: number; lat?: number },
  current: { lon: number | null; lat: number | null }
): { lon: number | null; lat: number | null } {
  return {
    lon: patch.lon !== undefined ? patch.lon : current.lon ?? null,
    lat: patch.lat !== undefined ? patch.lat : current.lat ?? null,
  };
}

/** Stored boundary_gps of a zone, or null when absent. */
async function zoneBoundaryGps(zoneId: string): Promise<unknown | null> {
  const res = await pool.query<{ boundary_gps: unknown }>(
    `SELECT boundary_gps FROM zones WHERE id = $1`,
    [zoneId]
  );
  return res.rows[0]?.boundary_gps ?? null;
}

/**
 * Count of nodes in a zone that already carry a GPS position — used as the
 * jitter index so several nodes created for the same zone in quick
 * succession do not stack on the exact same coordinates.
 */
async function placedNodeCountInZone(zoneId: string): Promise<number> {
  const res = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM nodes WHERE zone_id = $1 AND lat IS NOT NULL AND lon IS NOT NULL`,
    [zoneId]
  );
  return res.rows[0]?.c ?? 0;
}

/**
 * Auto-placement point for a node being assigned to a zone, or null when the
 * zone has no usable drawn boundary (the node keeps whatever position it has).
 */
async function placedPointForNode(zoneId: string): Promise<{ lat: number; lon: number } | null> {
  const boundary = await zoneBoundaryGps(zoneId);
  if (!boundary) return null;
  const index = await placedNodeCountInZone(zoneId);
  return autoPlacePointInside(boundary, index);
}

/** Zone id whose boundary contains [lon, lat], else null. */
async function detectContainingZone(
  farmId: string,
  lon: number,
  lat: number
): Promise<string | null> {
  const rows = await pool.query<{ id: string; boundary_gps: unknown }>(
    `SELECT id, boundary_gps FROM zones WHERE farm_id = $1 AND active AND boundary_gps IS NOT NULL`,
    [farmId]
  );
  for (const r of rows.rows) {
    if (polygonContains(r.boundary_gps, lon, lat)) return r.id;
  }
  return null;
}

/** Bounding box of the farm's drawn boundary, else the union of zone bboxes. */
async function farmBoundaryBBox(
  farmId: string
): Promise<[number, number, number, number] | null> {
  const farm = await pool.query<{ boundary_geojson: unknown }>(
    `SELECT boundary_geojson FROM farms WHERE id = $1`,
    [farmId]
  );
  const fb = polygonBBox(farm.rows[0]?.boundary_geojson ?? null);
  if (fb) return fb;

  const zones = await pool.query<{ boundary_gps: unknown }>(
    `SELECT boundary_gps FROM zones WHERE farm_id = $1 AND boundary_gps IS NOT NULL`,
    [farmId]
  );
  let bbox: [number, number, number, number] | null = null;
  for (const z of zones.rows) {
    const zb = polygonBBox(z.boundary_gps);
    if (!zb) continue;
    if (!bbox) {
      bbox = zb;
    } else {
      bbox = [
        Math.min(bbox[0], zb[0]),
        Math.min(bbox[1], zb[1]),
        Math.max(bbox[2], zb[2]),
        Math.max(bbox[3], zb[3]),
      ];
    }
  }
  return bbox;
}

/** Internal full-row resolver used by extended update + gates. */
async function resolveNodeRow(nodeId: string): Promise<{
  id: string;
  name: string;
  farm_id: string;
  zone_id: string | null;
  is_actuator: boolean;
  active: boolean;
  lon: number | null;
  lat: number | null;
}> {
  const result = await pool.query<{
    id: string;
    name: string;
    farm_id: string;
    zone_id: string | null;
    is_actuator: boolean;
    active: boolean;
    lon: number | null;
    lat: number | null;
  }>(
    `SELECT id, name, farm_id, zone_id, is_actuator, active, lon::float AS lon, lat::float AS lat
     FROM nodes WHERE id = $1`,
    [nodeId]
  );
  if (result.rowCount === 0) throw HttpError.notFound(`Node "${nodeId}" not found`);
  return result.rows[0];
}

async function assertNodeAccess(ctx: AccessContext | undefined, farmId: string, label: string): Promise<void> {
  if (ctx) await assertFarmAccess(ctx, farmId, label);
}

/**
 * Hard safety rule: a populated zone must always retain at least one ACTIVE
 * actuator node so water can be controlled. This helper asks whether applying
 * a change to `excludingNodeId` would leave its zone with ZERO active
 * actuators:
 *
 *   - Counts active (active = TRUE) actuator (is_actuator = TRUE) nodes in the
 *     zone, EXCLUDING the node being changed.
 *   - If the changed node will REMAIN an active actuator in the same zone
 *     (newIsActuatorValue === true — e.g. a sensor being promoted to valve
 *     driver), it still satisfies the requirement, so it is credited back.
 *     Every safety-relevant caller removes the node from the active-actuator
 *     count (toggle actuator off, move to another zone, deactivate, or delete)
 *     and therefore passes newIsActuatorValue: false.
 *   - A zone with zero nodes TOTAL is a different, already-handled case — the
 *     rule only applies to a POPULATED zone, so we return false there.
 */
async function wouldLeaveZoneWithoutActuator(
  zoneId: string | null,
  opts: { excludingNodeId?: string; newIsActuatorValue?: boolean } = {}
): Promise<boolean> {
  if (!zoneId) return false;

  const totalRes = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM nodes WHERE zone_id = $1`,
    [zoneId]
  );
  if ((totalRes.rows[0]?.c ?? 0) === 0) return false;

  const actRes = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM nodes
       WHERE zone_id = $1 AND active = TRUE AND is_actuator = TRUE
         AND id <> $2`,
    [zoneId, opts.excludingNodeId ?? ""]
  );
  let count = actRes.rows[0]?.c ?? 0;
  if (opts.excludingNodeId && opts.newIsActuatorValue === true) {
    count += 1;
  }
  return count <= 0;
}

/** The 400 message for the last-active-actuator rule, naming the zone. */
async function lastActuatorGuardMessage(zoneId: string | null): Promise<string> {
  let zoneName = "this zone";
  if (zoneId) {
    const z = await pool.query<{ name: string }>(`SELECT name FROM zones WHERE id = $1`, [zoneId]);
    if ((z.rowCount ?? 0) > 0 && z.rows[0].name) zoneName = z.rows[0].name;
  }
  return `This is the last active valve in ${zoneName} — at least one actuator is required per zone to maintain water control. Assign another node as an actuator first.`;
}

/** Fallback serial when the client does not supply one, e.g. "SN-3F9A2C1B". */
function generateNodeId(): string {
  return `SN-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

// ── Part 14: archival remove ────────────────────────────────────────────────

export interface DeleteNodeResult {
  deleted: true;
  mode: "hard" | "archived";
  telemetryCount?: number;
  logsCount?: number;
}

/**
 * History-aware removal:
 *   mid-irrigation            → 409 (never remove a running valve driver)
 *   zero telemetry + zero logs → hard DELETE
 *   either nonzero             → archive (active=false), counts returned so
 *                                the UI can say exactly what was preserved
 */
export async function deleteNodeArchival(
  nodeId: string,
  ctx?: AccessContext
): Promise<DeleteNodeResult> {
  const current = await resolveNodeRow(nodeId); // throws 404
  await assertNodeAccess(ctx, current.farm_id, "node");

  // HARD SAFETY — runs BEFORE the archive-vs-hard-delete decision: an ACTIVE
  // actuator that is a zone's last one cannot be removed (neither archived nor
  // hard-deleted), since its zone must keep an active valve for water control.
  if (current.is_actuator && current.active) {
    if (
      await wouldLeaveZoneWithoutActuator(current.zone_id, {
        excludingNodeId: nodeId,
        newIsActuatorValue: false,
      })
    ) {
      throw new HttpError(400, await lastActuatorGuardMessage(current.zone_id));
    }
  }

  // Mid-irrigation guard — an open valve command blocks removal.
  const running = await pool.query(
    `
    SELECT 1 FROM irrigation_logs
    WHERE node_id = $1 AND skipped = FALSE AND ended_at IS NULL
    LIMIT 1
    `,
    [nodeId]
  );
  if ((running.rowCount ?? 0) > 0) {
    throw new HttpError(409, `Node "${current.name}" is currently irrigating — stop the cycle before removing it`);
  }

  const counts = await pool.query<{
    telemetry_count: number;
    logs_count: number;
  }>(
    `
    SELECT
      (SELECT COUNT(*)::int FROM telemetry WHERE node_id = $1)      AS telemetry_count,
      (SELECT COUNT(*)::int FROM irrigation_logs WHERE node_id = $1) AS logs_count
    `,
    [nodeId]
  );
  const telemetryCount = counts.rows[0].telemetry_count;
  const logsCount = counts.rows[0].logs_count;

  if (telemetryCount === 0 && logsCount === 0) {
    const deleted = await pool.query(`DELETE FROM nodes WHERE id = $1`, [nodeId]);
    if ((deleted.rowCount ?? 0) === 0) throw HttpError.notFound(`Node "${nodeId}" not found`);
    return { deleted: true, mode: "hard" };
  }

  await pool.query(`UPDATE nodes SET active = FALSE, updated_at = NOW() WHERE id = $1`, [nodeId]);
  return { deleted: true, mode: "archived", telemetryCount, logsCount };
}

/** Reactivate an archived node — blocked while its zone is archived/missing. */
export async function reactivateNode(nodeId: string): Promise<NodeDto> {
  const zoneCheck = await pool.query<{ zone_id: string | null; zone_active: boolean | null }>(
    `
    SELECT n.zone_id, z.active AS zone_active
    FROM nodes n
    LEFT JOIN zones z ON z.id = n.zone_id
    WHERE n.id = $1
    `,
    [nodeId]
  );
  if (zoneCheck.rowCount === 0) throw HttpError.notFound(`Node "${nodeId}" not found`);
  const { zone_id, zone_active } = zoneCheck.rows[0];

  if (zone_id === null) {
    throw new HttpError(
      400,
      `This node's zone has been removed — it no longer belongs to a zone, so it cannot be reactivated. Reassign it to an active zone first.`
    );
  }
  if (zone_active === false) {
    throw new HttpError(
      400,
      `This node's zone is archived/inactive — reactivate the zone before reactivating its nodes.`
    );
  }

  const result = await pool.query<{ id: string }>(
    `UPDATE nodes SET active = TRUE, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [nodeId]
  );
  if ((result.rowCount ?? 0) === 0) throw HttpError.notFound(`Node "${nodeId}" not found`);
  return getNodeById(nodeId);
}

/**
 * Part 11: updates the per-node telemetry cadence override.
 * NULL clears the override (node falls back to the farm default).
 * Returns the fresh node plus orgId so the route can address the
 * retained MQTT config topic.
 */
export async function setNodeReadInterval(
  nodeId: string,
  readIntervalMs: number | null
): Promise<{ node: NodeDto; farmId: string; orgId: string }> {
  const result = await pool.query<{ id: string }>(
    `
    UPDATE nodes
    SET read_interval_ms = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING id, farm_id, (SELECT f.org_id FROM farms f WHERE f.id = nodes.farm_id) AS org_id
    `,
    [nodeId, readIntervalMs]
  );
  if (result.rowCount === 0) {
    throw HttpError.notFound(`Node "${nodeId}" not found`);
  }
  const { farm_id: farmId, org_id: orgId } = result.rows[0] as unknown as {
    farm_id: string;
    org_id: string;
  };
  const node = await getNodeById(nodeId);
  return { node, farmId, orgId };
}
