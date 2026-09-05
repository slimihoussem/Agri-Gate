/**
 * Migration 012: zone lifecycle management
 *
 *  - zones.active       soft-delete/archive flag (hard delete only when a
 *                       zone has zero nodes AND zero historical logs/alerts)
 *  - zones.boundary_gps optional per-zone GeoJSON boundary (farm-level
 *                       boundary_geojson stays as-is)
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE zones ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE zones ADD COLUMN IF NOT EXISTS boundary_gps JSONB;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE zones DROP COLUMN IF EXISTS boundary_gps;
    ALTER TABLE zones DROP COLUMN IF EXISTS active;
  `);
};
