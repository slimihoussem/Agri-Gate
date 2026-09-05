# AgriGate Database Layer (PostgreSQL 16 + TimescaleDB)

This directory and root configuration manage the persistence and time-series telemetry layer for the AgriGate precision-agriculture platform (pilot olive farm in Rgueb, Sidi Bouzid, Tunisia).

---

## 🚀 Quick Start with Docker

### 1. Start the TimescaleDB Container
```bash
docker compose up -d
```

### 2. Run Database Migrations
```bash
npm run migrate:up
```

### 3. Seed Database with 48 Hours of Telemetry
```bash
npm run seed
```

### 4. Full Database Reset
To drop the public schema, re-run all migrations, and seed fresh data:
```bash
npm run db:reset
```

---

## ⚙️ Environment Variables & Connection String

Required environment variables in `.env`:

```env
# Standard PostgreSQL Connection String
# NOTE: host port is 5433 (not 5432) — a local Windows PostgreSQL service
# already occupies 5432, so docker-compose.yml maps the container as 5433:5432.
DATABASE_URL=postgres://agrigat_user:agrigat_secret_pwd@localhost:5433/agrigat_db

# Discrete parameters for pg client & CLI tools
PGHOST=localhost
PGPORT=5433
PGUSER=agrigat_user
PGPASSWORD=agrigat_secret_pwd
PGDATABASE=agrigat_db
```

---

## 📐 GeoJSON Boundary Format (`boundary_geojson`)

The `farms.boundary_geojson` column stores standard RFC 7946 GeoJSON format for the field polygon:

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [9.681000, 35.020000],
      [9.688000, 35.021000],
      [9.687000, 35.024000],
      [9.682000, 35.023000],
      [9.681000, 35.020000]
    ]
  ]
}
```

> **Note**: In standard GeoJSON coordinate arrays, positions are always formatted as **`[longitude, latitude]`** (e.g. `[9.681, 35.020]` for Rgueb, Sidi Bouzid). The linear ring must be closed (first and last coordinate pairs are identical). Any future GPS boundary drawing feature in the frontend must produce and parse this exact structure.

---

## 📊 Database Architecture

### Relational Entities
- **`organizations`**: Multi-tenant isolation boundary.
- **`users`**: Platform administrators and field operators (`org_id`, `email`, `password_hash`, `full_name`, `role`).
- **`farms`**: Geographic entities (`org_id`, `name`, `location`, `latitude`, `longitude`, `boundary_geojson`).
- **`zones`**: Sub-parcels (`farm_id`, `name`, `crop_type`, `target_moisture`, `soil_type`, `area_hectares`).
- **`nodes`**: Deployed sensor hardware units (`id`, `farm_id`, `zone_id`, `name`, `comm_method`, `status`, `map_x`, `map_y`, `battery`, `rssi`, `last_seen_at`).

### Time-Series & TimescaleDB Hypertables
- **`telemetry`** (Hypertable):
  - 5-minute interval streaming timeseries partitioned into **1-day chunk intervals**.
  - Metrics: `soil_moisture`, `soil_temp`, `air_temp` (*distinct from soil temp*), `humidity`, `nitrogen`, `phosphorus`, `potassium`, `battery`, `rssi`.
  - Compression Policy: 1-day chunks compressed automatically after **7 days** using `timescaledb.compress_segmentby = 'farm_id, zone_id, node_id'` and `timescaledb.compress_orderby = 'time DESC'`.
  - Compound indexes on `(farm_id, time DESC)`, `(zone_id, time DESC)`, `(node_id, time DESC)` ensure partition chunk exclusion and high performance time-range scans.
- **`telemetry_hourly`** (Continuous Aggregate Materialized View):
  - Downsampled 1-hour bucket rollups with automatic background refresh policies.
  - Computes `avg_soil_moisture`, `avg_soil_temp`, `avg_air_temp`, `avg_humidity`, `avg_nitrogen`, `avg_phosphorus`, `avg_potassium`, `min_battery`, `avg_rssi`, and `reading_count`.

### Irrigation & Alerts
- **`irrigation_schedules`**: two schedule types via `schedule_type` — `recurring` (time-of-day, duration, repeat days array `[0..6]`, moisture trigger) and `one_time` (`scheduled_start`/`scheduled_end`, optional moisture trigger, `fired_at` once-stamped).
- **`irrigation_logs`**: Execution records with water delivered in litres and inline skip reasons.
- **`alerts`**: Real-time diagnostic events and threshold violations. Acknowledgment status is tracked via nullable **`acknowledged_at`** timestamp (`NULL` = unacknowledged, timestamp = acknowledged).

---

## 🔍 Verification Queries

### 1. Verify Hourly Continuous Aggregates
```sql
SELECT 
  bucket,
  node_id,
  ROUND(avg_soil_moisture::numeric, 2) AS avg_moisture_pct,
  ROUND(avg_soil_temp::numeric, 2) AS avg_soil_c,
  ROUND(avg_air_temp::numeric, 2) AS avg_air_c,
  ROUND(avg_humidity::numeric, 2) AS avg_humidity_pct,
  ROUND(avg_nitrogen::numeric, 2) AS avg_nitrogen_ppm,
  min_battery,
  reading_count
FROM telemetry_hourly
WHERE bucket >= NOW() - INTERVAL '24 hours'
ORDER BY bucket DESC, node_id ASC
LIMIT 10;
```

### 2. Verify Hypertable Chunk Exclusion (`EXPLAIN`)
```sql
EXPLAIN (COSTS OFF)
SELECT time, node_id, soil_moisture, air_temp
FROM telemetry
WHERE farm_id = (SELECT id FROM farms LIMIT 1)
  AND time >= NOW() - INTERVAL '24 hours'
ORDER BY time DESC;
```
*(Notice that the query planner targets only the active 1-day chunks within the 24h range and excludes all chunks outside the window).*
