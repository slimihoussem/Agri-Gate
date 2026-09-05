/**
 * Migration 002: TimescaleDB Telemetry Hypertable & Continuous Aggregate View
 */
exports.up = async (pgm) => {
  const { rows } = await pgm.db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'timescaledb'
    ) AS available
  `);

  const telemetrySql = rows[0].available
    ? `
    SELECT create_hypertable(
      'telemetry',
      'time',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists => TRUE
    );

    CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_hourly
    WITH (timescaledb.continuous) AS
    SELECT
      time_bucket('1 hour', time) AS bucket,
      farm_id,
      zone_id,
      node_id,
      AVG(soil_moisture) AS avg_soil_moisture,
      AVG(soil_temp) AS avg_soil_temp,
      AVG(air_temp) AS avg_air_temp,
      AVG(humidity) AS avg_humidity,
      AVG(nitrogen) AS avg_nitrogen,
      AVG(phosphorus) AS avg_phosphorus,
      AVG(potassium) AS avg_potassium,
      MIN(battery) AS min_battery,
      AVG(rssi)::numeric(5, 2) AS avg_rssi,
      COUNT(*) AS reading_count
    FROM telemetry
    GROUP BY bucket, farm_id, zone_id, node_id
    WITH NO DATA;

    SELECT add_continuous_aggregate_policy(
      'telemetry_hourly',
      start_offset => INTERVAL '3 days',
      end_offset => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists => TRUE
    );

    ALTER TABLE telemetry SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'farm_id, zone_id, node_id',
      timescaledb.compress_orderby = 'time DESC'
    );

    SELECT add_compression_policy(
      'telemetry',
      INTERVAL '7 days',
      if_not_exists => TRUE
    );
  `
    : `
    CREATE VIEW telemetry_hourly AS
    SELECT
      date_trunc('hour', time) AS bucket,
      farm_id,
      zone_id,
      node_id,
      AVG(soil_moisture) AS avg_soil_moisture,
      AVG(soil_temp) AS avg_soil_temp,
      AVG(air_temp) AS avg_air_temp,
      AVG(humidity) AS avg_humidity,
      AVG(nitrogen) AS avg_nitrogen,
      AVG(phosphorus) AS avg_phosphorus,
      AVG(potassium) AS avg_potassium,
      MIN(battery) AS min_battery,
      AVG(rssi)::numeric(5, 2) AS avg_rssi,
      COUNT(*) AS reading_count
    FROM telemetry
    GROUP BY date_trunc('hour', time), farm_id, zone_id, node_id;
  `;

  pgm.sql(`
    -- 1. Telemetry Timeseries Table
    CREATE TABLE IF NOT EXISTS telemetry (
      time TIMESTAMPTZ NOT NULL,
      node_id VARCHAR(50) NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      soil_moisture NUMERIC(5, 2),
      soil_temp NUMERIC(5, 2),
      air_temp NUMERIC(5, 2), -- Maps to telemetry.air_temp (distinct from soil_temp)
      humidity NUMERIC(5, 2),
      nitrogen NUMERIC(6, 2),
      phosphorus NUMERIC(6, 2),
      potassium NUMERIC(6, 2),
      battery NUMERIC(5, 2), -- Renamed from battery_level
      rssi INTEGER,
      PRIMARY KEY (time, node_id)
    );

    -- 3. High Performance Compound Indices for Range & Partition Pruning
    CREATE INDEX IF NOT EXISTS idx_telemetry_farm_time ON telemetry (farm_id, time DESC);
    CREATE INDEX IF NOT EXISTS idx_telemetry_zone_time ON telemetry (zone_id, time DESC);
    CREATE INDEX IF NOT EXISTS idx_telemetry_node_time ON telemetry (node_id, time DESC);
  `);

  pgm.sql(telemetrySql);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP MATERIALIZED VIEW IF EXISTS telemetry_hourly CASCADE;
    DROP VIEW IF EXISTS telemetry_hourly CASCADE;
    DROP TABLE IF EXISTS telemetry CASCADE;
  `);
};
