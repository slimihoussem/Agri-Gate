import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const FULL_CAPS = '["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"]';
    await client.query(`
      INSERT INTO nodes (id, farm_id, zone_id, name, comm_method, status, map_x, map_y, battery, rssi, last_seen_at, is_actuator,
                         lat, lon, sensor_capabilities, flow_rate_l_per_min, max_runtime_minutes, installed_at, notes)
      VALUES 
        ('SN-RG-01', '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666', 'Node 01 -- North Ridge', 'wifi', 'online', 28.0, 26.0, 94.0, -58, NOW() - INTERVAL '1 minute', TRUE,
         35.0219, 9.6828, $1::jsonb, 16.0, 120, NOW() - INTERVAL '5 months', 'North ridge head unit -- main Zone A valve line.');
    `, [FULL_CAPS]);
    await client.query("COMMIT");
    console.log("Success!");
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

test();