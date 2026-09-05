/**
 * Migration 008: configurable settings (Part 11)
 *
 * 1. `settings` — per-farm key/value overrides of the platform defaults
 *    (one row per key; see src/settings/defaults.ts for the canonical list).
 * 2. `nodes.read_interval_ms` — nullable per-node telemetry cadence override;
 *    NULL means "use the farm default" (DEFAULT_READ_INTERVAL_MS).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS settings (
      farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      key VARCHAR(100) NOT NULL,
      value NUMERIC NOT NULL,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (farm_id, key)
    );

    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS read_interval_ms INTEGER
      CHECK (read_interval_ms IS NULL OR read_interval_ms >= 1000);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS settings;
    ALTER TABLE nodes DROP COLUMN IF EXISTS read_interval_ms;
  `);
};
