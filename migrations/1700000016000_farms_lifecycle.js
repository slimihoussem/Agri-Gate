/**
 * Migration 016: farm lifecycle + admin console fields (Part 12 ext)
 *
 *  - farms.active          archive flag (same pattern as zones/nodes)
 *  - farms.center_lat/lon  farm center coordinates (distinct from nodes'
 *                          per-node lat/lon)
 *  - farms.total_area_ha   total farm area in hectares
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE farms ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE farms ADD COLUMN IF NOT EXISTS center_lat DOUBLE PRECISION;
    ALTER TABLE farms ADD COLUMN IF NOT EXISTS center_lon DOUBLE PRECISION;
    ALTER TABLE farms ADD COLUMN IF NOT EXISTS total_area_ha DOUBLE PRECISION;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE farms DROP COLUMN IF EXISTS total_area_ha;
    ALTER TABLE farms DROP COLUMN IF EXISTS center_lon;
    ALTER TABLE farms DROP COLUMN IF EXISTS center_lat;
    ALTER TABLE farms DROP COLUMN IF EXISTS active;
  `);
};
