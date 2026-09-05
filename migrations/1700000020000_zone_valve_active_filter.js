/**
 * Migration 020: zone-valve uniqueness must respect archival.
 *
 * 019 created idx_one_zone_valve_per_zone as `WHERE is_zone_valve = true`.
 * Deletion is soft (nodes.active=false), so an archived zone valve would
 * keep occupying the zone's single valve slot. Recreate the index filtered on
 * active=true so removing a valve frees the slot (app pre-check matches).
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_one_zone_valve_per_zone;
    CREATE UNIQUE INDEX idx_one_zone_valve_per_zone
      ON nodes (zone_id)
      WHERE is_zone_valve = true AND active = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_one_zone_valve_per_zone;
    CREATE UNIQUE INDEX idx_one_zone_valve_per_zone
      ON nodes (zone_id)
      WHERE is_zone_valve = true;
  `);
};