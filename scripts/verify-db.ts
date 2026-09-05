import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://agrigat_user:agrigat_secret_pwd@localhost:5432/agrigat_db";

async function verify() {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  console.log("🔍 Running AgriGate TimescaleDB Verification Queries...\n");

  try {
    // 1. Query telemetry_hourly continuous aggregate
    console.log("==================================================");
    console.log("1. Telemetry Hourly Continuous Aggregate Averages:");
    console.log("==================================================");
    const hourlyRes = await client.query(`
      SELECT 
        bucket,
        node_id,
        ROUND(avg_soil_moisture::numeric, 2) AS avg_soil_moisture_pct,
        ROUND(avg_soil_temp::numeric, 2) AS avg_soil_temp_c,
        ROUND(avg_air_temp::numeric, 2) AS avg_air_temp_c,
        ROUND(avg_humidity::numeric, 2) AS avg_humidity_pct,
        ROUND(avg_nitrogen::numeric, 2) AS avg_nitrogen_ppm,
        ROUND(avg_phosphorus::numeric, 2) AS avg_phosphorus_ppm,
        ROUND(avg_potassium::numeric, 2) AS avg_potassium_ppm,
        min_battery,
        reading_count
      FROM telemetry_hourly
      WHERE bucket >= NOW() - INTERVAL '24 hours'
      ORDER BY bucket DESC, node_id ASC
      LIMIT 6;
    `);
    console.table(hourlyRes.rows);

    // 2. EXPLAIN query for hypertable chunk exclusion
    console.log("\n==================================================");
    console.log("2. EXPLAIN Analysis (Chunk Exclusion Verification):");
    console.log("==================================================");
    const explainRes = await client.query(`
      EXPLAIN (COSTS OFF)
      SELECT time, node_id, soil_moisture, air_temp, battery
      FROM telemetry
      WHERE farm_id = (SELECT id FROM farms LIMIT 1)
        AND time >= NOW() - INTERVAL '24 hours'
      ORDER BY time DESC;
    `);
    console.log(explainRes.rows.map((r: any) => r["QUERY PLAN"]).join("\n"));

    console.log("\n✅ Database and TimescaleDB Continuous Aggregates Verified Successfully!");
  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
