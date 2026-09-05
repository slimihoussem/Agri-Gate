import { pool } from "../db/pool";
import { ZoneTrend } from "../schemas/telemetry.schema";

// ── Part 3: farm trend (hourly aggregate) ───────────────────────────────────

type HourlyBucketRow = {
  zone_id: string;
  zone_name: string;
  bucket: Date;
  avg_moisture: number;
};

/**
 * Moisture trend from the telemetry_hourly continuous aggregate for the
 * last N hours (default 24), grouped by bucket and averaged across the
 * nodes reporting within each zone.
 *
 * Deliberately GENERIC — zones are keyed by their own id/name, never
 * hardcoded aliases like zoneA/zoneB/zoneC. Works for any number of zones.
 * Zones with no readings inside the window are returned with empty points.
 *
 * Note: the continuous aggregate refresh policy lags up to ~1h behind
 * (end_offset => INTERVAL '1 hour'), so the newest point may be up to an
 * hour old. That is a data-layer property, not a bug here.
 */
export async function getMoistureTrend(farmId: string, hours: number): Promise<ZoneTrend[]> {
  const [bucketResult, zoneResult] = await Promise.all([
    pool.query<HourlyBucketRow>(
      `
      SELECT th.zone_id,
             z.name AS zone_name,
             th.bucket,
             ROUND(AVG(th.avg_soil_moisture)::numeric, 2)::float AS avg_moisture
      FROM telemetry_hourly th
      INNER JOIN zones z ON z.id = th.zone_id
      WHERE th.farm_id = $1
        AND th.bucket >= NOW() - ($2::int * INTERVAL '1 hour')
      GROUP BY th.zone_id, z.name, th.bucket
      ORDER BY th.zone_id ASC, th.bucket ASC
      `,
      [farmId, hours]
    ),
    pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM zones WHERE farm_id = $1 ORDER BY created_at ASC, name ASC`,
      [farmId]
    ),
  ]);

  const byZone = new Map<string, ZoneTrend>();
  for (const zone of zoneResult.rows) {
    byZone.set(zone.id, { zoneId: zone.id, zoneName: zone.name, points: [] });
  }
  for (const row of bucketResult.rows) {
    let trend = byZone.get(row.zone_id);
    if (!trend) {
      trend = { zoneId: row.zone_id, zoneName: row.zone_name, points: [] };
      byZone.set(row.zone_id, trend);
    }
    trend.points.push({
      time: row.bucket.toISOString(),
      avgMoisture: row.avg_moisture,
    });
  }
  return Array.from(byZone.values());
}


// ── Part 12: per-node raw telemetry history ─────────────────────────────────

export interface NodeTelemetryPoint {
  time: string;
  soilMoisture: number | null;
  soilTemp: number | null;
  airTemp: number | null;
  airHumidity: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  battery: number | null;
  rssi: number | null;
}

type RawTelemetryRow = {
  time: Date;
  soil_moisture: string | number | null;
  soil_temp: string | number | null;
  air_temp: string | number | null;
  humidity: string | number | null;
  nitrogen: string | number | null;
  phosphorus: string | number | null;
  potassium: string | number | null;
  battery: string | number | null;
  rssi: number | null;
};

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * RAW single-node history (not the hourly aggregate): smoother chart for one
 * node, and new/offline nodes simply return an empty points array — the
 * frontend renders an explicit "No telemetry data" state for that.
 */
export async function getNodeTelemetryHistory(
  nodeId: string,
  hours: number
): Promise<{ points: NodeTelemetryPoint[] }> {
  const result = await pool.query<RawTelemetryRow>(
    `
    SELECT time, soil_moisture, soil_temp, air_temp, humidity,
           nitrogen, phosphorus, potassium, battery, rssi
    FROM telemetry
    WHERE node_id = $1
      AND time >= NOW() - ($2::int * INTERVAL '1 hour')
    ORDER BY time ASC
    `,
    [nodeId, hours]
  );

  return {
    points: result.rows.map((row) => ({
      time: row.time.toISOString(),
      soilMoisture: num(row.soil_moisture),
      soilTemp: num(row.soil_temp),
      airTemp: num(row.air_temp),
      airHumidity: num(row.humidity),
      nitrogen: num(row.nitrogen),
      phosphorus: num(row.phosphorus),
      potassium: num(row.potassium),
      battery: num(row.battery),
      rssi: num(row.rssi),
    })),
  };
}
