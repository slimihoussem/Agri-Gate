/**
 * Migration 013: node archival (Part 14)
 *
 * Remove/archived pattern for nodes, mirroring zones:
 *  - active = false keeps the node + its history but hides it from default
 *    views and node-assignment dropdowns
 *  - hard delete is only allowed when the node has zero telemetry AND zero
 *    irrigation_logs (enforced application-level in DELETE /api/nodes/:id)
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_nodes_active ON nodes(active);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_nodes_active;
    ALTER TABLE nodes DROP COLUMN IF EXISTS active;
  `);
};
