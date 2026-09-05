/**
 * Migration 004: Telemetry idempotent-ingestion dedupe constraint
 *
 * The MQTT ingestion service (Part 4) inserts with
 *   ON CONFLICT (node_id, time) DO NOTHING
 * so a retried/replayed publish of the same reading never creates a
 * duplicate row. This named UNIQUE constraint is the explicit arbitration
 * target for that conflict clause.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE telemetry
      ADD CONSTRAINT uq_telemetry_node_time UNIQUE (node_id, time);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE telemetry
      DROP CONSTRAINT IF EXISTS uq_telemetry_node_time;
  `);
};
