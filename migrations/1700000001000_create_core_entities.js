/**
 * Migration 001: Core Extensions and Multi-Tenant Entities
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Enable Core Extensions
    -- TimescaleDB is available in the local Docker image but not required by
    -- Supabase. Migration 002 selects the native PostgreSQL fallback when it
    -- is unavailable.
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'
      ) THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE';
      END IF;
    END $$;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- 2. Organizations Table
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 3. Users Table
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'farmer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 4. Farms Table
    CREATE TABLE IF NOT EXISTS farms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      latitude NUMERIC(9, 6),
      longitude NUMERIC(9, 6),
      boundary_geojson JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 5. Zones Table
    CREATE TABLE IF NOT EXISTS zones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      crop_type VARCHAR(255) NOT NULL,
      target_moisture NUMERIC(5, 2) NOT NULL DEFAULT 50.0,
      soil_type VARCHAR(100),
      area_hectares NUMERIC(6, 2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 6. Nodes Table (Renamed from sensor_nodes)
    CREATE TABLE IF NOT EXISTS nodes (
      id VARCHAR(50) PRIMARY KEY,
      farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      comm_method VARCHAR(50) NOT NULL DEFAULT 'wifi',
      status VARCHAR(50) NOT NULL DEFAULT 'online',
      map_x NUMERIC(5, 2),
      map_y NUMERIC(5, 2),
      battery NUMERIC(5, 2),
      rssi INTEGER,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes for relational lookup speed
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
    CREATE INDEX IF NOT EXISTS idx_farms_org ON farms(org_id);
    CREATE INDEX IF NOT EXISTS idx_zones_farm ON zones(farm_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_farm ON nodes(farm_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_zone ON nodes(zone_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS nodes CASCADE;
    DROP TABLE IF EXISTS zones CASCADE;
    DROP TABLE IF EXISTS farms CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS organizations CASCADE;
  `);
};
