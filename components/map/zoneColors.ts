/**
 * Deterministic, collision-free per-zone colors for the Farm Map.
 *
 * Colors are assigned by SORTED RANK of the zone ids that actually render, so
 * the same set of zones always yields the same colors across reloads, and any
 * small set (2-3 zones) is guaranteed to get distinct colors — unlike a raw
 * hash of the zone id, which can collide (e.g. sequential UUIDs 6666…/7777…
 * both hashing to index 0). The full id set is passed so map layers and the
 * legend produce identical assignments.
 */

export interface ZoneColor {
  fill: string;
  stroke: string;
}

/** 8 clearly artificial, high-contrast colors that stand out on satellite AND street views. */
export const ZONE_COLORS: string[] = [
  "#EF4444", // red
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#A855F7", // purple
  "#06B6D4", // cyan
  "#EC4899", // pink
  "#84CC16", // lime
  "#F97316", // orange
];

/** Palette in the { fill, stroke } shape used by map + legend — same color for both edges and fill. */
export const ZONE_PALETTE: ZoneColor[] = ZONE_COLORS.map((c) => ({ fill: c, stroke: c }));

/** Farm boundary style — dashed light outline, no fill. */
export const FARM_BOUNDARY_STYLE = {
  color: "#F1F0E8",
  weight: 3,
  opacity: 0.9,
  dashArray: "8 8",
  fill: false,
} as const;

/**
 * Deterministic, distinct color per zone derived from the FULL set of zone ids
 * that are about to render. Sorted by id (stable across reloads), then each
 * zone takes the next palette color by rank — guaranteeing no collisions for up
 * to ZONE_PALETTE.length zones, and cycling uniformly if there are more.
 */
export function zoneColorsById(zoneIds: string[]): Record<string, ZoneColor> {
  const sorted = [...zoneIds].sort();
  const result: Record<string, ZoneColor> = {};
  sorted.forEach((id, i) => {
    result[id] = ZONE_PALETTE[i % ZONE_PALETTE.length];
  });
  return result;
}
