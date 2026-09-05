/**
 * Migration 019: Zone valve concept.
 *
 * A "zone valve" is ONE dedicated main-valve node per zone — separate,
 * independent infrastructure from the regular field-node actuators that run
 * irrigation schedules. A zone valve:
 *   - is_actuator = true (reuses all existing irrigation control)
 *   - is_zone_valve = true  (this column)
 *   - sensor_capabilities = '[]' (no sensor data expected or shown)
 *
 * SAFETY RULE (enforced app-side in the stop route, see nodeService/irrigationService):
 * the farm must keep at least one zone valve open across ALL zones. Closing the
 * LAST open one is blocked unless a technician/admin force-closes it.
 *
 * Data constraints:
 *   - at most ONE zone valve per zone (partial unique index)
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_zone_valve BOOLEAN NOT NULL DEFAULT false;

    -- Enforce at most one ACTIVE zone valve per zone. Archival is soft-delete
    -- (active=false), so an archived valve recedes and frees the slot. Race
    -- protection at the DB level; the app also pre-checks and returns a
    -- friendly 409 before this fires.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_zone_valve_per_zone
      ON nodes (zone_id)
      WHERE is_zone_valve = true AND active = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_one_zone_valve_per_zone;
    ALTER TABLE nodes DROP COLUMN IF EXISTS is_zone_valve;
  `);
};