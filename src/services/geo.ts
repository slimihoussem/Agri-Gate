/**
 * GPS auto-derivation helpers used by the farm/zone/node services.
 *
 * All coordinates follow the GeoJSON / turf convention: [lon, lat]. This gives
 * us three automatic behaviors when real GPS boundaries/positions are saved:
 *
 *   1. farm  -> total_area_ha from the drawn boundary polygon
 *   2. zone  -> area_hectares from the drawn boundary polygon
 *   3. node  -> containing-zone auto-detect (point-in-polygon) + on-map x/y %
 *               derived from GPS relative to the farm boundary bbox
 */

import * as turf from "@turf/turf";

/** Area of a GeoJSON polygon in HECTARES (1 ha = 10 000 m²). 0 if invalid. */
export function polygonAreaHa(geo: unknown): number {
  const poly = toTurfPolygon(geo);
  if (!poly) return 0;
  try {
    const sqMeters = turf.area(poly);
    return Number.isFinite(sqMeters) && sqMeters > 0 ? sqMeters / 10000 : 0;
  } catch {
    return 0;
  }
}

/** true when the [lon, lat] point lies inside the given GeoJSON polygon. */
export function polygonContains(geo: unknown, lon: number, lat: number): boolean {
  const poly = toTurfPolygon(geo);
  if (!poly) return false;
  try {
    return turf.booleanPointInPolygon(turf.point([lon, lat]), poly);
  } catch {
    return false;
  }
}

/**
 * Map a node's GPS to its on-map x/y percentage (0-100) relative to the farm
 * boundary bounding box. x = east %, y = north % (top of the map = 100).
 * Returns null when there is no usable bounding box (no boundary drawn yet /
 * degenerate polygon).
 */
export function gpsToXY(
  lon: number,
  lat: number,
  bbox: [number, number, number, number] | null
): { x: number; y: number } | null {
  if (!bbox) return null;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const w = maxLon - minLon;
  const h = maxLat - minLat;
  if (!(w > 0) || !(h > 0)) return null;
  const x = ((lon - minLon) / w) * 100;
  // y grows with latitude (north is up on the map)
  const y = ((lat - minLat) / h) * 100;
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
  };
}

/** Bounding box [minLon, minLat, maxLon, maxLat] of a polygon, else null. */
export function polygonBBox(geo: unknown): [number, number, number, number] | null {
  const poly = toTurfPolygon(geo);
  if (!poly) return null;
  try {
    const b = turf.bbox(poly).slice(0, 4) as [number, number, number, number];
    return b;
  } catch {
    return null;
  }
}

/**
 * Pick a point inside a zone's boundary for auto-placement of a node on
 * create / zone change. Server-side mirror of the Farm Map's boundary-save
 * logic (components/map/autoPlace.ts): random points within a widened bounding
 * box until one falls inside the polygon, then the polygon centroid as
 * fallback. `index` adds a deterministic micro-jitter so nodes created in
 * quick succession for the same zone do not stack on the exact same point.
 * Returns null when the polygon is unusable.
 */
export function autoPlacePointInside(
  geo: unknown,
  index = 0
): { lat: number; lon: number } | null {
  const poly = toTurfPolygon(geo);
  if (!poly) return null;
  const bbox = polygonBBox(geo);
  if (!bbox) return null;
  const attempts = 24;
  for (let a = 0; a < attempts; a += 1) {
    // deterministic perturbation per index + attempt so repeats differ
    const jitter = (index * 7 + a * 13) / 1000;
    const widened: [number, number, number, number] = [
      bbox[0] - jitter,
      bbox[1] - jitter,
      bbox[2] + jitter,
      bbox[3] + jitter,
    ];
    try {
      const fc = turf.randomPoint(1, { bbox: widened });
      const p = fc.features[0]?.geometry.coordinates as [number, number] | undefined;
      if (p) {
        const inside = turf.booleanPointInPolygon(turf.point([p[0], p[1]]), poly);
        if (inside) {
          return { lon: p[0] + (index % 5) * 1e-6, lat: p[1] + (index % 7) * 1e-6 };
        }
      }
    } catch {
      /* retry */
    }
  }
  // Fallback: centroid of the polygon (pointOnFeature), then a small jitter.
  try {
    const centroid = turf.pointOnFeature(poly).geometry.coordinates as [number, number];
    return { lon: centroid[0] + (index % 5) * 1e-6, lat: centroid[1] + (index % 7) * 1e-6 };
  } catch {
    return { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
  }
}

function toTurfPolygon(geo: unknown): ReturnType<typeof turf.polygon> | null {
  if (!geo || typeof geo !== "object") return null;
  const g = geo as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Polygon") return null;
  const coords = g.coordinates as number[][][] | undefined;
  if (!coords || coords.length === 0) return null;
  const ring = coords[0];
  if (!ring || ring.length < 3) return null;
  try {
    const poly = turf.polygon(coords as Parameters<typeof turf.polygon>[0]);
    if (!(turf.area(poly) > 0.001)) return null;
    return poly;
  } catch {
    return null;
  }
}
