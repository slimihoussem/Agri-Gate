/**
 * Migration 006: nodes.is_actuator — Part 9
 *
 * Irrigation schedules are per-ZONE but MQTT commands are per-NODE, so each
 * zone needs one designated actuator node (relay-controlled valve driver).
 * Backfill marks one seeded node per pilot zone:
 *   Zone A • North Grove     → SN-RG-01
 *   Zone B • South Slope     → SN-RG-04
 *   Zone C • Terraced Basin  → SN-RG-06
 * scripts/seed.ts inserts the same flags so db:reset preserves them.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_actuator BOOLEAN NOT NULL DEFAULT FALSE;

    UPDATE nodes SET is_actuator = TRUE
    WHERE id IN ('SN-RG-01', 'SN-RG-04', 'SN-RG-06');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes DROP COLUMN IF EXISTS is_actuator;
  `);
};
