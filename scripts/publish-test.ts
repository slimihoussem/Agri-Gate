/**
 * One-off live test publisher (not part of the platform).
 * Publishes one valid telemetry frame to SN-RG-02 via MQTT.
 */
import * as dotenv from "dotenv";

dotenv.config();

import mqtt from "mqtt";
import { pool } from "../src/db/pool";
import { randomUUID } from "crypto";

async function main(): Promise<void> {
  const farmRes = await pool.query<{ org_id: string; id: string }>(
    `SELECT org_id, id FROM farms LIMIT 1`
  );
  const { org_id: orgId, id: farmId } = farmRes.rows[0];
  const topic = `agrigate/${orgId}/${farmId}/SN-RG-02/telemetry`;
  const payload = {
    soilMoisture: 51.8,
    nitrogen: 222,
    phosphorus: 55,
    potassium: 183,
    soilTemp: 25.1,
    airTemp: 30.4,
    airHumidity: 41.2,
    battery: 91,
    rssi: -61,
    timestamp: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(
      process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1884"
    );
    client.on("error", reject);
    client.on("connect", () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, () => {
        console.log(`PUBLISHED ${topic}`);
        client.end(true);
        resolve();
      });
    });
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
