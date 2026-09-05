/**
 * Migration 003: Irrigation Automation & Alert Logging
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Irrigation Schedules Table
    CREATE TABLE IF NOT EXISTS irrigation_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      start_time TIME NOT NULL,
      duration_minutes INTEGER NOT NULL,
      repeat_days INTEGER[] NOT NULL, -- Array of days 0=Sun..6=Sat
      moisture_threshold NUMERIC(5, 2) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 2. Irrigation Execution Logs Table
    CREATE TABLE IF NOT EXISTS irrigation_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ NOT NULL,
      skipped BOOLEAN NOT NULL DEFAULT false,
      skip_reason TEXT,
      water_used_litres NUMERIC(10, 2) NOT NULL DEFAULT 0,
      triggered_by VARCHAR(50) NOT NULL DEFAULT 'schedule', -- 'schedule', 'manual', 'threshold'
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 3. Alerts Table
    -- Note: acknowledged boolean dropped; acknowledged_at is the single source of truth (NULL = unacknowledged)
    CREATE TABLE IF NOT EXISTS alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      node_id VARCHAR(50) REFERENCES nodes(id) ON DELETE SET NULL,
      type VARCHAR(100) NOT NULL,
      severity VARCHAR(50) NOT NULL, -- 'info', 'warning', 'critical'
      message TEXT NOT NULL,
      value VARCHAR(100), -- Renamed from value_recorded
      acknowledged_at TIMESTAMPTZ, -- NULL means unacknowledged, timestamp means acknowledged
      acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
      triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Performance Indices
    CREATE INDEX IF NOT EXISTS idx_irrigation_schedules_zone ON irrigation_schedules(zone_id);
    CREATE INDEX IF NOT EXISTS idx_irrigation_logs_zone_time ON irrigation_logs(zone_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_farm_unack ON alerts(farm_id, triggered_at DESC) WHERE acknowledged_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_alerts_farm_ack ON alerts(farm_id, acknowledged_at, triggered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_zone ON alerts(zone_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS alerts CASCADE;
    DROP TABLE IF EXISTS irrigation_logs CASCADE;
    DROP TABLE IF EXISTS irrigation_schedules CASCADE;
  `);
};
