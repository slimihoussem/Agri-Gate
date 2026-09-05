/**
 * Migration 011: extended node configuration (Part 13 ext)
 *
 *  - lat/lon               GPS position (DOUBLE PRECISION)
 *  - sensor_capabilities    JSONB array; valid keys: soilMoisture, nitrogen,
 *                           phosphorus, potassium, soilTemp, airTemp,
 *                           airHumidity. Zone aggregates only include a node
 *                           for fields it actually measures.
 *  - flow_rate_l_per_min    actuator metering (NULL = unmetered — runs record
 *                           NULL water instead of a guessed constant)
 *  - max_runtime_minutes    per-node hard safety cutoff sent to firmware via
 *                           the retained config topic
 *  - installed_at / notes   install metadata
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS sensor_capabilities JSONB NOT NULL DEFAULT '["soilMoisture"]';
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS flow_rate_l_per_min REAL;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS max_runtime_minutes INTEGER DEFAULT 60;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS notes TEXT;

    -- Water metering must be able to represent UNMETERED runs visibly.
    ALTER TABLE irrigation_logs ALTER COLUMN water_used_litres DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE irrigation_logs ALTER COLUMN water_used_litres SET NOT NULL;
    ALTER TABLE nodes DROP COLUMN IF EXISTS notes;
    ALTER TABLE nodes DROP COLUMN IF EXISTS installed_at;
    ALTER TABLE nodes DROP COLUMN IF EXISTS max_runtime_minutes;
    ALTER TABLE nodes DROP COLUMN IF EXISTS flow_rate_l_per_min;
    ALTER TABLE nodes DROP COLUMN IF EXISTS sensor_capabilities;
    ALTER TABLE nodes DROP COLUMN IF EXISTS lon;
    ALTER TABLE nodes DROP COLUMN IF EXISTS lat;
  `);
};
