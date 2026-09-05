import * as dotenv from "dotenv";
dotenv.config();
import mqtt from "mqtt";
import { pool } from "../src/db/pool";
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [nodeId, moisture] = args;
  const r = await pool.query<{ org_id: string; id: string }>(`SELECT org_id, id FROM farms LIMIT 1`);
  const topic = `agrigate/${r.rows[0].org_id}/${r.rows[0].id}/${nodeId}/telemetry`;
  const payload = JSON.stringify({ soilMoisture: Number(moisture), nitrogen: 220, phosphorus: 55, potassium: 185, soilTemp: 24, airTemp: 29, airHumidity: 42, battery: 80, rssi: -60, timestamp: new Date().toISOString() });
  await new Promise<void>((resolve, reject) => {
    const c = mqtt.connect(process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1884");
    c.on("error", reject);
    c.on("connect", () => c.publish(topic, payload, { qos: 1 }, () => { console.log(`PUBLISHED ${nodeId} @ ${moisture}%`); c.end(true); resolve(); }));
  });
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
