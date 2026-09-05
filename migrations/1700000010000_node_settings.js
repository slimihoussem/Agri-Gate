/**
 * Migration 010: per-node alert threshold overrides (Part 13)
 *
 * Layered on top of the farm-level `settings` table. Same key namespace as
 * farm settings (plain keys like 'moistureLow') so the merge is a simple
 * lookup: node override > farm override > hardcoded default.
 *
 * NOTE: node_id is VARCHAR(50) to match nodes.id (hardware serials like
 * SN-RG-01), not UUID.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS node_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      node_id VARCHAR(50) NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL,
      value TEXT,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (node_id, key)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS node_settings;
  `);
};
