/**
 * One-time / repeatable backfill for zone & farm areas.
 *
 * Some boundaries were saved BEFORE the auto-calculate-area feature existed, so
 * a row could have a real GeoJSON polygon (boundary_gps / boundary_geojson) but
 * a NULL or 0 area (area_hectares / total_area_ha). This recomputes the area
 * from the stored boundary using the SAME server-side calculation the live
 * save path uses (`src/services/geo.ts` → `polygonAreaHa`, i.e. turf.area / 10000)
 * and writes it back, so it is an exact one-time catch-up — not a replacement
 * for the ongoing auto-calculate-on-save logic.
 *
 * It is a no-op on rows that already have a boundary AND a computed area (or
 * genuinely have no boundary at all) — those are left untouched.
 */
import { Pool, PoolClient } from "pg";
import * as dotenv from "dotenv";
import { pool } from "../src/db/pool";
import { polygonAreaHa } from "../src/services/geo";

/** Minimal query surface — both a `Pool` and a `PoolClient` satisfy this. */
type QueryRunner = { query: Pool["query"] } & Pick<Pool, "query">;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Backfill missing computed areas for zones and farms whose boundary is set but
 * whose area is missing. Pass your own runner to participate in a transaction
 * (e.g. the seed's `client`); otherwise it uses the shared pool.
 *
 * @returns a summary `{ zones, farms, log }` (log is also printed here).
 */
export async function backfillMissingAreas(
  runner: QueryRunner = pool
): Promise<{ zones: number; farms: number; log: string[] }> {
  const log: string[] = [];

  // ── Zones: boundary set, but area missing or zero ───────────────────────
  const zones = await runner.query<{
    id: string;
    name: string;
    boundary_gps: unknown;
    area_hectares: number | null;
  }>(
    `SELECT id, name, boundary_gps, area_hectares
     FROM zones
     WHERE boundary_gps IS NOT NULL
       AND (area_hectares IS NULL OR area_hectares = 0)
     ORDER BY name`
  );

  for (const z of zones.rows) {
    const area = round3(polygonAreaHa(z.boundary_gps));
    if (area <= 0) {
      log.push(`zone  ${z.name} [${z.id}] — boundary present but could not compute a valid area; skipped`);
      continue;
    }
    await runner.query(`UPDATE zones SET area_hectares = $1 WHERE id = $2`, [area, z.id]);
    log.push(`zone  ${z.name} [${z.id}] — area backfilled → ${area} ha`);
  }

  // ── Farms: boundary set, but total area missing or zero ─────────────────
  const farms = await runner.query<{
    id: string;
    name: string;
    boundary_geojson: unknown;
    total_area_ha: number | null;
  }>(
    `SELECT id, name, boundary_geojson, total_area_ha
     FROM farms
     WHERE boundary_geojson IS NOT NULL
       AND (total_area_ha IS NULL OR total_area_ha = 0)
     ORDER BY name`
  );

  for (const f of farms.rows) {
    const area = round3(polygonAreaHa(f.boundary_geojson));
    if (area <= 0) {
      log.push(`farm   ${f.name} [${f.id}] — boundary present but could not compute a valid area; skipped`);
      continue;
    }
    await runner.query(`UPDATE farms SET total_area_ha = $1 WHERE id = $2`, [area, f.id]);
    log.push(`farm   ${f.name} [${f.id}] — area backfilled → ${area} ha`);
  }

  for (const line of log) console.log(`[backfill-areas] ${line}`);
  console.log(
    `[backfill-areas] done — ${zones.rows.length} zone(s), ${farms.rows.length} farm(s) backfilled`
  );
  return { zones: zones.rows.length, farms: farms.rows.length, log };
}

// ── Standalone entry point: `npm run backfill:areas` (or `tsx scripts/backfill-areas.ts`) ──
if (require.main === module) {
  dotenv.config();
  backfillMissingAreas()
    .then(() => pool.end())
    .catch((err) => {
      console.error("❌ Backfill failed:", err);
      process.exit(1);
    });
}
