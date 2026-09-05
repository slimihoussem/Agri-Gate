import { Pool } from "pg";
import * as dotenv from "dotenv";
// Shared diurnal model — same curves the Part 6 simulator uses live.
import {
  microclimate,
  isInMorningIrrigationWindow,
  MORNING_IRRIGATION,
} from "../src/simulator/diurnalModel";
// Keep zone/farm areas consistent whenever a boundary is seeded without an area
// (a fresh reset would otherwise reproduce boundary-without-area rows).
import { backfillMissingAreas } from "./backfill-areas";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://agrigat_user:agrigat_secret_pwd@localhost:5433/agrigat_db";

const pool = new Pool({ connectionString });

/**
 * STABLE SEED UUIDs — hardcoded so that db:reset is idempotent for the
 * core test accounts. This ensures:
 * - JWT tokens remain valid across resets (same userId in token)
 * - Farm context / sessionStorage survives resets (same farmId/orgId)
 * - Developer workflow: log in once, keep working after reset
 *
 * Only these named entities are stable. Any ad-hoc farms/nodes/users
 * created manually during a session are correctly wiped on reset.
 */
const SEED_IDS = {
  // Organizations
  ORG_PILOT: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // AgriGate Pilot Org
  ORG_SECOND: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", // Second Client Org (test)
  ORG_KAIROUAN: "cccccccc-cccc-cccc-cccc-cccccccccccc", // Kairouan Cooperative (test)
  ORG_SFAX: "dddddddd-dddd-dddd-dddd-dddddddddddd", // Sfax Cooperative (test)

  // Users
  USER_PLATFORM_ADMIN: "11111111-1111-1111-1111-111111111111", // platform@agri-gate.tn
  USER_ADMIN: "22222222-2222-2222-2222-222222222222", // admin@agri-gate.tn
  USER_TECHNICIAN: "33333333-3333-3333-3333-333333333333", // technician@agri-gate.tn
  USER_FARMER: "44444444-4444-4444-4444-444444444444", // farmer@agri-gate.tn

  // Farm
  FARM_PILOT: "55555555-5555-5555-5555-555555555555", // Rgueb Pilot Farm

  // Zones
  ZONE_A: "66666666-6666-6666-6666-666666666666", // Zone A • North Grove
  ZONE_B: "77777777-7777-7777-7777-777777777777", // Zone B • South Slope
  ZONE_C: "88888888-8888-8888-8888-888888888888", // Zone C • Terraced Basin

  // Nodes (string IDs)
  NODE_01: "SN-RG-01",
  NODE_02: "SN-RG-02",
  NODE_03: "SN-RG-03",
  NODE_04: "SN-RG-04",
  NODE_05: "SN-RG-05",
  NODE_06: "SN-RG-06",

  // Other test farms (created by admin console in earlier parts)
  FARM_OUED: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", // Oued El Ma Test Farm
  FARM_OULED: "ffffffff-ffff-ffff-ffff-ffffffffffff", // Ouled Hassen Farm
  FARM_CHIHIA: "00000000-0000-0000-0000-000000000001", // Chihia Farm
} as const;

async function seed() {
  const client = await pool.connect();
  console.log("🌱 Starting AgriGate Database Seeding...");

  try {
    await client.query("BEGIN");

    // 1. Clean existing data in reverse dependency order
    console.log("🧹 Truncating existing tables...");
    await client.query(`
      TRUNCATE TABLE alerts, irrigation_logs, irrigation_schedules, telemetry, 
                     nodes, zones, farms, users, organizations CASCADE;
    `);

    // 2. Insert Organizations with FIXED UUIDs
    console.log("🏢 Creating Organizations...");
    await client.query(`
      INSERT INTO organizations (id, name)
      VALUES 
        ('${SEED_IDS.ORG_PILOT}', 'AgriGate Pilot Org'),
        ('${SEED_IDS.ORG_SECOND}', 'Second Client Org (test)'),
        ('${SEED_IDS.ORG_KAIROUAN}', 'Kairouan Cooperative (test)'),
        ('${SEED_IDS.ORG_SFAX}', 'Sfax Cooperative (test)');
    `);

    // 3. Insert Users with FIXED UUIDs
    // ⚠ DEV-ONLY CREDENTIALS — documented in src/auth/README.md.
    // Never reuse these passwords in any real deployment.
    console.log("👤 Creating Users...");
    await client.query(`
      INSERT INTO users (id, org_id, farm_id, email, password_hash, full_name, role)
      VALUES 
        ('${SEED_IDS.USER_ADMIN}', NULL, NULL, 'admin@agri-gate.tn', crypt('AdminPass2026!', gen_salt('bf')), 'Houssem (Administrator)', 'admin'),
        ('${SEED_IDS.USER_TECHNICIAN}', NULL, NULL, 'technician@agri-gate.tn', crypt('TechPass2026!', gen_salt('bf')), 'Field Technician', 'technician'),
        ('${SEED_IDS.USER_PLATFORM_ADMIN}', NULL, NULL, 'platform@agri-gate.tn', crypt('PlatformPass2026!', gen_salt('bf')), 'AgriGate Platform Admin', 'admin');
    `);

    // 4. Insert Farm (Rgueb Pilot Farm, Sidi Bouzid, Tunisia) with FIXED UUID
    console.log("🚜 Creating Farm...");
    await client.query(`
      INSERT INTO farms (id, org_id, name, location, latitude, longitude, boundary_geojson)
      VALUES (
        '${SEED_IDS.FARM_PILOT}', 
        '${SEED_IDS.ORG_PILOT}', 
        'Rgueb Pilot Farm', 
        'Rgueb, Sidi Bouzid, Tunisia', 
        35.021500, 
        9.684200, 
        '{"type": "Polygon", "coordinates": [[[9.681, 35.020], [9.688, 35.021], [9.687, 35.024], [9.682, 35.023], [9.681, 35.020]]]}'::jsonb
      );
    `);

    await client.query(`
      INSERT INTO users (id, org_id, farm_id, email, password_hash, full_name, role)
      VALUES ('${SEED_IDS.USER_FARMER}', '${SEED_IDS.ORG_PILOT}', '${SEED_IDS.FARM_PILOT}',
              'farmer@agri-gate.tn', crypt('FarmerPass2026!', gen_salt('bf')), 'Pilot Field Operator', 'farmer');
    `);

    // 5. Insert 3 Zones with FIXED UUIDs
    console.log("🌳 Creating Pilot Zones...");
    await client.query(`
      INSERT INTO zones (id, farm_id, name, crop_type, target_moisture, soil_type, area_hectares)
      VALUES 
        ('${SEED_IDS.ZONE_A}', '${SEED_IDS.FARM_PILOT}', 'Zone A • North Grove', 'Chemlali Olive Trees (180 trees)', 50.0, 'Sandy Loam', 2.4),
        ('${SEED_IDS.ZONE_B}', '${SEED_IDS.FARM_PILOT}', 'Zone B • South Slope', 'Chemlali Olive Trees (140 trees)', 45.0, 'Clay Loam', 1.8),
        ('${SEED_IDS.ZONE_C}', '${SEED_IDS.FARM_PILOT}', 'Zone C • Terraced Basin', 'Sayali Olive Trees (95 trees)', 45.0, 'Rocky Calcareous', 1.2);
    `);

    // 6. Insert Sensor Nodes (into 'nodes' table, using 'battery')
    // is_actuator: one designated valve-driver node per zone (Part 9)
    // Part 13 ext: sensor_capabilities, actuator metering/safety, install metadata
    console.log("📡 Creating Sensor Nodes (nodes table)...");
    const FULL_CAPS = '["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"]';
    await client.query(`
      INSERT INTO nodes (id, farm_id, zone_id, name, comm_method, status, map_x, map_y, battery, rssi, last_seen_at, is_actuator,
                         lat, lon, sensor_capabilities, flow_rate_l_per_min, max_runtime_minutes, installed_at, notes)
      VALUES 
        ($1, $2, $3, 'Node 01 — North Ridge', 'wifi', 'online', 28.0, 26.0, 94.0, -58, NOW() - INTERVAL '1 minute', TRUE,
         35.0219, 9.6828, $4::jsonb, 16.0, 120, NOW() - INTERVAL '5 months', 'North ridge head unit — main Zone A valve line.'),
        ($5, $6, $7, 'Node 02 — Central Well', 'wifi', 'online', 44.0, 34.0, 88.0, -64, NOW() - INTERVAL '3 minutes', FALSE,
         35.0208, 9.6841, $8::jsonb, NULL, NULL, NOW() - INTERVAL '5 months', 'Well-side reference probe, full sensor suite.'),
        ($9, $10, $11, 'Node 03 — East Perimeter', 'wifi', 'online', 62.0, 24.0, 72.0, -71, NOW() - INTERVAL '4 minutes', FALSE,
         35.0227, 9.6863, $12::jsonb, NULL, NULL, NOW() - INTERVAL '4 months', NULL),
        ($13, $14, $15, 'Node 04 — South Gully', 'wifi', 'warning', 36.0, 72.0, 42.0, -79, NOW() - INTERVAL '14 minutes', TRUE,
         35.0194, 9.6852, $16::jsonb, 14.0, 90, NOW() - INTERVAL '3 months', 'South gully valve — battery degrading, schedule replacement.'),
        ($17, $18, $19, 'Node 05 — Lower Drip Line', 'wifi', 'online', 64.0, 68.0, 82.0, -66, NOW() - INTERVAL '2 minutes', FALSE,
         35.0186, 9.6848, $20::jsonb, NULL, NULL, NOW() - INTERVAL '3 months', 'Moisture-only probe on the lower drip manifold.'),
        ($21, $22, $23, 'Node 06 — Terraced Outpost', 'wifi', 'offline', 82.0, 48.0, 11.0, -93, NOW() - INTERVAL '4 hours 12 minutes', TRUE,
         35.0236, 9.6871, $24::jsonb, 12.0, 60, NOW() - INTERVAL '6 months', 'Terrace outpost valve — weakest WiFi coverage.');
    `, [
      SEED_IDS.NODE_01, SEED_IDS.FARM_PILOT, SEED_IDS.ZONE_A, FULL_CAPS,
      SEED_IDS.NODE_02, SEED_IDS.FARM_PILOT, SEED_IDS.ZONE_A, FULL_CAPS,
      SEED_IDS.NODE_03, SEED_IDS.FARM_PILOT, SEED_IDS.ZONE_A, FULL_CAPS,
      SEED_IDS.NODE_04, SEED_IDS.FARM_PILOT, SEED_IDS.ZONE_B, FULL_CAPS,
      SEED_IDS.NODE_05, SEED_IDS.FARM_PILOT, SEED_IDS.ZONE_B, '["soilMoisture","soilTemp"]',
      SEED_IDS.NODE_06, SEED_IDS.FARM_PILOT, SEED_IDS.ZONE_C, FULL_CAPS,
    ]);

    // 7. Generate ~48 Hours of 5-Minute Diurnal Telemetry
    console.log("⏱ Generating 48 hours of 5-minute TimescaleDB telemetry (diurnal variation)...");
    const now = new Date();
    const startTime = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const stepMinutes = 5;
    const totalSteps = (48 * 60) / stepMinutes; // 576 steps

    const nodesList = [
      { id: SEED_IDS.NODE_01, zoneId: SEED_IDS.ZONE_A, baseMoisture: 55, baseBattery: 96, baseRssi: -58, N: 225, P: 56, K: 188, active: true },
      { id: SEED_IDS.NODE_02, zoneId: SEED_IDS.ZONE_A, baseMoisture: 53, baseBattery: 90, baseRssi: -64, N: 220, P: 54, K: 182, active: true },
      { id: SEED_IDS.NODE_03, zoneId: SEED_IDS.ZONE_A, baseMoisture: 54, baseBattery: 75, baseRssi: -71, N: 218, P: 55, K: 185, active: true },
      { id: SEED_IDS.NODE_04, zoneId: SEED_IDS.ZONE_B, baseMoisture: 36, baseBattery: 45, baseRssi: -79, N: 175, P: 24, K: 145, active: true },
      { id: SEED_IDS.NODE_05, zoneId: SEED_IDS.ZONE_B, baseMoisture: 37, baseBattery: 84, baseRssi: -66, N: 178, P: 25, K: 146, active: true },
      // Node 06 stopped reporting 4 hours ago
      { id: SEED_IDS.NODE_06, zoneId: SEED_IDS.ZONE_C, baseMoisture: 42, baseBattery: 15, baseRssi: -93, N: 140, P: 42, K: 120, active: false, stopAfterHours: 44 },
    ];

    // Batch insert telemetry readings (using 'battery' column)
    const telemetryBatchSize = 300;
    let batchValues: any[] = [];
    let paramIndex = 1;
    let valuePlaceholders: string[] = [];

    const flushBatch = async () => {
      if (valuePlaceholders.length === 0) return;
      const query = `
        INSERT INTO telemetry (
          time, node_id, zone_id, farm_id, soil_moisture, soil_temp, air_temp, 
          humidity, nitrogen, phosphorus, potassium, battery, rssi
        ) VALUES ${valuePlaceholders.join(", ")};
      `;
      await client.query(query, batchValues);
      batchValues = [];
      valuePlaceholders = [];
      paramIndex = 1;
    };

    for (let step = 0; step < totalSteps; step++) {
      const readingTime = new Date(startTime.getTime() + step * stepMinutes * 60 * 1000);
      const hourOfDay = readingTime.getHours() + readingTime.getMinutes() / 60;

      // Diurnal microclimate for Sidi Bouzid — shared model (see src/simulator/diurnalModel.ts)
      const climate = microclimate(hourOfDay);
      const airTemp = climate.airTemp;
      const soilTemp = climate.soilTemp;
      const humidity = climate.humidity;

      for (const node of nodesList) {
        // If node stopped reporting earlier (e.g. SN-RG-06)
        if (!node.active && node.stopAfterHours && step > (node.stopAfterHours * 60) / stepMinutes) {
          continue;
        }

        // Soil moisture dynamics:
        let moistureDelta = -((step / totalSteps) * (node.zoneId === SEED_IDS.ZONE_B ? 4.5 : 2.0));
        
        // Spike in Zone A during the shared morning irrigation window
        if (node.zoneId === SEED_IDS.ZONE_A) {
          if (isInMorningIrrigationWindow(hourOfDay)) {
            moistureDelta += MORNING_IRRIGATION.boost;
          }
        }

        const moisture = Math.max(10, Math.min(85, +(node.baseMoisture + moistureDelta + (Math.random() * 0.6 - 0.3)).toFixed(2)));
        const battery = Math.max(5, +(node.baseBattery - (step / totalSteps) * 2.5 + (Math.random() * 0.2 - 0.1)).toFixed(2));
        const rssi = Math.round(node.baseRssi + (Math.random() * 4 - 2));

        valuePlaceholders.push(
          `($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6}, $${paramIndex+7}, $${paramIndex+8}, $${paramIndex+9}, $${paramIndex+10}, $${paramIndex+11}, $${paramIndex+12})`
        );
        batchValues.push(
          readingTime,
          node.id,
          node.zoneId,
          SEED_IDS.FARM_PILOT,
          moisture,
          soilTemp,
          airTemp,
          humidity,
          node.N + Math.round(Math.random() * 4 - 2),
          node.P + Math.round(Math.random() * 2 - 1),
          node.K + Math.round(Math.random() * 4 - 2),
          battery,
          rssi
        );
        paramIndex += 13;

        if (valuePlaceholders.length >= telemetryBatchSize) {
          await flushBatch();
        }
      }
    }
    await flushBatch();

    // 8. Insert Irrigation Schedules
    console.log("💧 Creating Irrigation Schedules...");
    await client.query(`
      INSERT INTO irrigation_schedules (zone_id, start_time, duration_minutes, repeat_days, moisture_threshold, active)
      VALUES 
        ('${SEED_IDS.ZONE_A}', '05:30:00', 45, ARRAY[1, 3, 5], 48.0, true),
        ('${SEED_IDS.ZONE_B}', '18:00:00', 60, ARRAY[2, 4, 6], 45.0, true),
        ('${SEED_IDS.ZONE_C}', '05:00:00', 50, ARRAY[0, 3], 40.0, false);
    `);

    // 10. Insert Irrigation Execution Logs
    console.log("📜 Creating Irrigation Logs...");
    await client.query(`
      INSERT INTO irrigation_logs (zone_id, started_at, ended_at, skipped, skip_reason, water_used_litres, triggered_by)
      VALUES 
        ('${SEED_IDS.ZONE_A}', NOW() - INTERVAL '5 hours 30 minutes', NOW() - INTERVAL '4 hours 45 minutes', false, NULL, 720.0, 'schedule'),
        ('${SEED_IDS.ZONE_B}', NOW() - INTERVAL '1 day 6 hours', NOW() - INTERVAL '1 day 5 hours', false, NULL, 850.0, 'schedule'),
        ('${SEED_IDS.ZONE_A}', NOW() - INTERVAL '2 days 5 hours 30 minutes', NOW() - INTERVAL '2 days 5 hours 30 minutes', true, 'Soil moisture (58%) exceeded threshold (48%) after morning fog', 0.0, 'threshold'),
        ('${SEED_IDS.ZONE_C}', NOW() - INTERVAL '3 days 5 hours', NOW() - INTERVAL '3 days 5 hours', true, 'Sensor Node SN-RG-06 offline — safety lockout prevented unmonitored cycle', 0.0, 'threshold'),
        ('${SEED_IDS.ZONE_B}', NOW() - INTERVAL '4 days 6 hours', NOW() - INTERVAL '4 days 5 hours', false, NULL, 830.0, 'schedule');
    `);

    // 11. Insert Alerts (using 'value', acknowledged_at timestamp instead of boolean)
    console.log("🚨 Creating Alerts & Diagnostics...");
    await client.query(`
      INSERT INTO alerts (farm_id, zone_id, node_id, type, severity, message, value, acknowledged_at, acknowledged_by, triggered_at)
      VALUES 
        ('${SEED_IDS.FARM_PILOT}', '${SEED_IDS.ZONE_C}', '${SEED_IDS.NODE_06}', 'Node Offline', 'critical', 'Telemetry heartbeat missing for >4 hours. Last reported battery at 11%.', '-93 dBm / 11%', NULL, NULL, NOW() - INTERVAL '24 minutes'),
        ('${SEED_IDS.FARM_PILOT}', '${SEED_IDS.ZONE_B}', NULL, 'Soil Moisture Deficit', 'critical', 'Zone B moisture dropped to 33% (threshold: 45%). Olive stress threshold imminent.', '33%', NULL, NULL, NOW() - INTERVAL '58 minutes'),
        ('${SEED_IDS.FARM_PILOT}', '${SEED_IDS.ZONE_B}', '${SEED_IDS.NODE_04}', 'Low Battery & Weak RSSI', 'warning', 'Node battery down to 42% and signal attenuated to -79 dBm in southern gully.', '42% / -79 dBm', NULL, NULL, NOW() - INTERVAL '2 hours'),
        ('${SEED_IDS.FARM_PILOT}', '${SEED_IDS.ZONE_B}', NULL, 'Nutrient Imbalance', 'warning', 'Phosphorus level detected at 24 ppm, below target optimal range (30-80 ppm).', '24 ppm', NULL, NULL, NOW() - INTERVAL '3 hours'),
        ('${SEED_IDS.FARM_PILOT}', '${SEED_IDS.ZONE_A}', NULL, 'Irrigation Completed', 'info', 'Morning scheduled drip cycle finished successfully. Delivered 720 L of water.', '720 L', NOW() - INTERVAL '4 hours 30 minutes', '${SEED_IDS.USER_ADMIN}', NOW() - INTERVAL '5 hours'),
        ('${SEED_IDS.FARM_PILOT}', NULL, NULL, 'Gateway Sync Check', 'info', 'Daily cloud synchronization verified across local MQTT broker & base station.', 'MQTT 200 OK', NOW() - INTERVAL '6 hours', '${SEED_IDS.USER_ADMIN}', NOW() - INTERVAL '7 hours'),
        ('${SEED_IDS.FARM_PILOT}', '${SEED_IDS.ZONE_C}', '${SEED_IDS.NODE_06}', 'Signal Packet Loss', 'warning', 'Packet loss on terrace repeater exceeded 25% threshold before disconnect.', '28% Loss', NOW() - INTERVAL '1 day 4 hours', '${SEED_IDS.USER_ADMIN}', NOW() - INTERVAL '1 day 5 hours');
    `);

    // 11b. Backfill any boundary-without-area rows (e.g. the seeded farm has a
    // boundary_geojson poly but no total_area_ha). Runs INSIDE the transaction
    // so a freshly reset DB is always consistent.
    console.log("📐 Backfilling zone/farm areas from drawn boundaries...");
    await backfillMissingAreas(client);

    await client.query("COMMIT");

    // 12. Refresh TimescaleDB Continuous Aggregate View
    // NOTE: must run OUTSIDE the transaction block —
    // refresh_continuous_aggregate() is a procedure call that cannot run
    // inside BEGIN/COMMIT.
    const { rows: extensionRows } = await client.query<{ available: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
      ) AS available;
    `);
    if (extensionRows[0]?.available) {
      console.log("⚡ Refreshing continuous aggregate 'telemetry_hourly'...");
      await client.query(`
        CALL refresh_continuous_aggregate('telemetry_hourly', NOW() - INTERVAL '3 days', NOW());
      `);
    } else {
      console.log("⚡ Using native PostgreSQL telemetry_hourly view (no TimescaleDB refresh needed).");
    }

    console.log("✅ AgriGate Database Seeding Completed Successfully!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error during database seeding:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});