/**
 * Migration 009: per-node irrigation granularity
 *
 * 1. irrigation_schedules.node_id — the schedule now TARGETS one specific
 *    actuator node instead of "the zone's single actuator". zone_id is kept
 *    (denormalized from the node's zone) because moisture gating and history
 *    views are still zone-scoped.
 *    NOTE: typed VARCHAR(50) to match nodes.id (hardware serials like
 *    SN-RG-01) — not UUID, despite the ticket text.
 * 2. Backfill: existing schedules inherit their zone's current is_actuator
 *    node when one exists; anything left NULL is reported in the output and
 *    will simply never fire (scheduler joins on a valid actuator node).
 * 3. irrigation_logs.node_id — which node executed each run; new rows always
 *    set it.
 * 4. ended_at becomes nullable so an OPEN run is representable:
 *    ended_at IS NULL AND skipped = FALSE ⇔ valve currently commanded open.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE irrigation_schedules
      ADD COLUMN IF NOT EXISTS node_id VARCHAR(50) REFERENCES nodes(id) ON DELETE CASCADE;

    UPDATE irrigation_schedules s
    SET node_id = a.node_id
    FROM (
      SELECT DISTINCT ON (zone_id) id AS node_id, zone_id
      FROM nodes
      WHERE is_actuator = TRUE AND zone_id IS NOT NULL
      ORDER BY zone_id, id
    ) a
    WHERE s.node_id IS NULL AND s.zone_id = a.zone_id;

    DO $$
    DECLARE remaining INT;
    BEGIN
      SELECT COUNT(*) INTO remaining FROM irrigation_schedules WHERE node_id IS NULL;
      RAISE NOTICE '[migration 0009] % schedule(s) left without a node (zone had no is_actuator node) — they will not fire until assigned', remaining;
    END $$;

    ALTER TABLE irrigation_logs
      ADD COLUMN IF NOT EXISTS node_id VARCHAR(50) REFERENCES nodes(id);

    ALTER TABLE irrigation_logs ALTER COLUMN ended_at DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE irrigation_logs ALTER COLUMN ended_at SET NOT NULL;
    ALTER TABLE irrigation_logs DROP COLUMN IF EXISTS node_id;
    ALTER TABLE irrigation_schedules DROP COLUMN IF EXISTS node_id;
  `);
};
