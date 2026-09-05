/**
 * AgriGate virtual node farm — Part 6 entrypoint.
 *
 * Spawns one VirtualNode per ACTIVE seeded node in the database, each with
 * its own MQTT client (id = nodes.mqtt_client_id, backfilled to the node
 * serial) and its own simulated WiFi reliability. Proves the full pipeline:
 *
 *   simulator → Mosquitto → Part 4 ingestion → TimescaleDB → Part 3 API
 */
import * as dotenv from "dotenv";

dotenv.config();

import { pool } from "../db/pool";
import { VirtualNode } from "./virtualNode";

const BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1884";
// Real firmware publishes every 5 min; default here is fast for testing.
const INTERVAL_MS = Number(process.env.SIMULATE_INTERVAL_MS ?? 15_000);
const UNRELIABLE_WIFI = (process.env.SIMULATE_UNRELIABLE_WIFI ?? "true") !== "false";

type NodeRow = {
  id: string;
  name: string;
  farm_id: string;
  org_id: string;
  zone_name: string | null;
  mqtt_client_id: string | null;
  battery: number | null;
  rssi: number | null;
  status: string;
  is_actuator: boolean;
  last_moisture: number | null;
};

async function main(): Promise<void> {
  console.log(
    `\n🌾 AgriGate simulator starting — broker=${BROKER_URL}, interval=${INTERVAL_MS}ms, unreliableWifi=${UNRELIABLE_WIFI}\n`
  );

  const result = await pool.query<NodeRow>(
    `
    SELECT n.id, n.name, n.farm_id, f.org_id, z.name AS zone_name,
           n.mqtt_client_id, n.battery, n.rssi, n.status, n.is_actuator,
           latest.soil_moisture AS last_moisture
    FROM nodes n
    INNER JOIN farms f ON f.id = n.farm_id
    LEFT JOIN zones z ON z.id = n.zone_id
    LEFT JOIN LATERAL (
      SELECT soil_moisture
      FROM telemetry t
      WHERE t.node_id = n.id
      ORDER BY time DESC
      LIMIT 1
    ) latest ON TRUE
    ORDER BY n.id ASC
    `
  );

  if (result.rowCount === 0) {
    console.error("❌ No active nodes found — run migrations + seed first.");
    await pool.end();
    process.exit(1);
  }

  const nodes = result.rows.map((row) => {
    const virtual = new VirtualNode(
      {
        nodeId: row.id,
        name: row.name,
        orgId: row.org_id,
        farmId: row.farm_id,
        zoneName: row.zone_name,
        clientId: row.mqtt_client_id ?? row.id,
        brokerUrl: BROKER_URL,
        intervalMs: INTERVAL_MS,
        unreliableWifi: UNRELIABLE_WIFI,
        isActuator: row.is_actuator,
        batteryStart: Number(row.battery ?? 90),
        rssiBase: Math.max(-95, Number(row.rssi ?? -70)),
        // Continue seamlessly from wherever the seeded history ended;
        moistureBase: Number(row.last_moisture ?? 45),
      },
      undefined
    );
    virtual.start();
    return { row, virtual };
  });

  console.log(
    `✅ spawned ${nodes.length} virtual node(s): ` +
      nodes
        .map(
          (n) =>
            `${n.row.id}${n.row.status === "offline" ? " (flagged offline — revives on first publish)" : ""}`
        )
        .join(", ") +
      `\n`
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n🌾 ${signal} received — stopping ${nodes.length} virtual node(s)…`);
    await Promise.all(nodes.map((n) => n.virtual.stop()));
    await pool.end();
    console.log("🌾 simulator stopped cleanly");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("💥 simulator crashed:", err);
  process.exit(1);
});
