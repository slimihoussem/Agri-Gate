/**
 * Turf.js helpers for the Farm Map's automatic node placement.
 *
 * After a zone boundary is saved (new or edited) we place any node belonging
 * to that zone that has no real GPS yet, or whose current location falls
 * outside the just-saved polygon, into a point inside the polygon. Placement
 * only stages positions (returned here) — it never writes to the backend.
 */

import * as turf from "@turf/turf";
import type { GeojsonPolygon } from "@/lib/api";
import type { SensorNode } from "@/lib/types";

export interface PlaceResult {
  /** nodeId -> staged lat/lon (in the API's north/east order). */
  changes: Record<string, { lat: number; lon: number }>;
  /** number of nodes that already had a valid in-polygon position (untouched). */
  alreadyInside: number;
}

/** Convert a GeoJSON Polygon to a turf polygon feature (defensive). */
function toTurfPolygon(geo: GeojsonPolygon | null | undefined): ReturnType<typeof turf.polygon> | null {
  if (!geo) return null;
  const coords = geo.coordinates;
  if (!coords || coords.length === 0) return null;
  const ring = coords[0];
  if (!ring || ring.length < 3) return null;
  try {
    const poly = turf.polygon(coords as Parameters<typeof turf.polygon>[0]);
    if (!Boolean(turf.area(poly) > 0.001)) return null;
    return poly;
  } catch {
    return null;
  }
}

/** true when the [lon, lat] point sits inside the given polygon. */
function pointInPolygon(lon: number, lat: number, poly: ReturnType<typeof turf.polygon>): boolean {
  try {
    return turf.booleanPointInPolygon(turf.point([lon, lat]), poly);
  } catch {
    return false;
  }
}

/**
 * Area (hectares) of a GeoJSON polygon, computed with turf.area (m²) / 10000.
 * The client sends this alongside the boundary in the same save call so the
 * backend can store it directly. Returns 0 when there is no usable boundary.
 */
export function geoAreaHectares(geo: GeojsonPolygon | null | undefined): number {
  const poly = toTurfPolygon(geo);
  if (!poly) return 0;
  return turf.area(poly) / 10000;
}

/**
 * Place zone nodes that lack a valid in-polygon position.
 *
 * @param zoneId        the zone whose boundary was just saved
 * @param polygon       the just-saved boundary (the source of truth, not a stale fetch)
 * @param nodes         all farm nodes
 * @returns staged changes (nodeId -> lat/lon) and a count of untouched nodes
 */
export function autoPlaceNodes(
  zoneId: string,
  polygon: GeojsonPolygon | null,
  nodes: SensorNode[]
): PlaceResult {
  const poly = toTurfPolygon(polygon);
  const changes: Record<string, { lat: number; lon: number }> = {};
  if (!poly) return { changes, alreadyInside: 0 };

  let alreadyInside = 0;
  const candidates = nodes.filter((n) => n.zoneId === zoneId);

  // Candidate list in a stable order so jitter is deterministic per reload.
  const needPlacement: SensorNode[] = [];
  for (const n of candidates) {
    const hasLonLat = typeof n.lon === "number" && typeof n.lat === "number";
    if (hasLonLat && pointInPolygon(n.lon as number, n.lat as number, poly)) {
      alreadyInside += 1;
      continue;
    }
    needPlacement.push(n);
  }

  const bbox4 = (turf.bbox(poly).slice(0, 4) as unknown) as [number, number, number, number];

  needPlacement.forEach((n, i) => {
    const point = pickPointInside(poly, bbox4, i);
    changes[n.id] = { lat: point[1], lon: point[0] };
  });

  return { changes, alreadyInside };
}

/**
 * Pick a point inside the polygon that avoids exact overlap with the other
 * staged nodes (index-based jitter + retries on randomPoint).
 */
function pickPointInside(
  poly: ReturnType<typeof turf.polygon>,
  bbox: [number, number, number, number],
  index: number
): [number, number] {
  const attempts = 24;
  for (let a = 0; a < attempts; a++) {
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
      if (p && pointInPolygon(p[0], p[1], poly)) {
        return [p[0] + (index % 5) * 1e-6, p[1] + (index % 7) * 1e-6];
      }
    } catch {
      /* retry */
    }
  }
  // Fallback: centroid of the polygon (pointOnFeature), then a small jitter.
  try {
    const centroid = turf.pointOnFeature(poly).geometry.coordinates as [number, number];
    return [centroid[0] + (index % 5) * 1e-6, centroid[1] + (index % 7) * 1e-6];
  } catch {
    const cx = (bbox[0] + bbox[2]) / 2;
    const cy = (bbox[1] + bbox[3]) / 2;
    return [cx, cy];
  }
}
