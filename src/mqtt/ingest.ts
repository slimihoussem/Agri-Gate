/**
 * AgriGate MQTT ingestion service — Part 4 entrypoint.
 *
 * Subscribes to:
 *   agrigate/+/+/+/telemetry   (sensor readings)
 *   agrigate/+/+/+/status      (heartbeats)
 *
 * Runs as a SEPARATE process from the Part 3 REST API and reuses the same
 * src/db/pool.ts — never create a second pool.
 * No actuator commands here: publishing to devices is Part 9.
 */
import * as dotenv from "dotenv";

dotenv.config();

import mqtt from "mqtt";
import { pool } from "../db/pool";
import {
  statusPayloadSchema,
  telemetryPayloadSchema,
} from "./schemas/telemetryPayload.schema";
import { handleTelemetry } from "./handlers/telemetryHandler";
import { handleStatus } from "./handlers/statusHandler";
// Part 8: periodic offline detection + alert generation, same always-on process.
import { startOfflineSweep } from "../alerts/offlineSweep";
// Part 9: minute-tick irrigation scheduler (fire-or-skip → MQTT commands).
import { startIrrigationScheduler } from "../irrigation/scheduler";

const BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const TELEMETRY_FILTER = "agrigate/+/+/+/telemetry";
const STATUS_FILTER = "agrigate/+/+/+/status";

type TopicParts = {
  orgId: string;
  farmId: string;
  nodeId: string;
  kind: "telemetry" | "status";
};

/** agrigate/{orgId}/{farmId}/{nodeId}/{kind} → parts, or null when malformed. */
function parseTopic(topic: string): TopicParts | null {
  const segments = topic.split("/");
  if (
    segments.length !== 5 ||
    segments[0] !== "agrigate" ||
    segments[1].length === 0 ||
    segments[2].length === 0 ||
    segments[3].length === 0
  ) {
    return null;
  }
  const kind = segments[4];
  if (kind !== "telemetry" && kind !== "status") return null;
  return { orgId: segments[1], farmId: segments[2], nodeId: segments[3], kind };
}

const client = mqtt.connect(BROKER_URL, {
  clientId: `agrigate-ingest-${process.pid}`,
  clean: true,
  reconnectPeriod: 3000,
});

client.on("connect", () => {
  console.log(`[mqtt-ingest] connected to broker ${BROKER_URL}`);
  client.subscribe(
    [TELEMETRY_FILTER, STATUS_FILTER],
    { qos: 1 },
    (err, granted) => {
      if (err) {
        console.error("[mqtt-ingest] ❌ subscription failed:", err.message);
        return;
      }
      for (const g of granted ?? []) {
        // Subscription confirmations are logged per spec.
        console.log(`[mqtt-ingest] subscribed to ${g.topic} (qos ${g.qos})`);
      }
    }
  );
});

client.on("reconnect", () => {
  console.log("[mqtt-ingest] … reconnecting to broker");
});

client.on("error", (err) => {
  console.error("[mqtt-ingest] broker connection error:", err.message);
});

client.on("message", (topic, payloadBuffer) => {
  void routeMessage(topic, payloadBuffer).catch((err) => {
    // One bad message must NEVER take down the service.
    console.error(`[mqtt-ingest] 💥 handler error on "${topic}":`, err);
  });
});

async function routeMessage(topic: string, payloadBuffer: Buffer): Promise<void> {
  const parts = parseTopic(topic);
  if (!parts) {
    console.warn(`[mqtt-ingest] ⚠ dropped message on malformed topic "${topic}"`);
    return;
  }

  const raw = payloadBuffer.toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(
      `[mqtt-ingest] ❌ INVALID JSON on "${topic}" — raw payload: ${raw}`
    );
    return;
  }

  const receivedAt = new Date();

  if (parts.kind === "telemetry") {
    const parsed = telemetryPayloadSchema.safeParse(json);
    if (!parsed.success) {
      // Validation failures are logged with the raw payload — silent
      // failures are not acceptable in the field-connectivity debug trail.
      console.error(
        `[mqtt-ingest] ❌ VALIDATION FAILED on "${topic}" — raw payload: ${raw}\n` +
          `    issues: ${parsed.error.errors
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`
      );
      return;
    }
    await handleTelemetry(parts.nodeId, parts.farmId, parsed.data, receivedAt);
    return;
  }

  const parsedStatus = statusPayloadSchema.safeParse(json);
  if (!parsedStatus.success) {
    console.error(
      `[mqtt-ingest] ❌ VALIDATION FAILED on "${topic}" — raw payload: ${raw}\n` +
        `    issues: ${parsedStatus.error.errors
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
    );
    return;
  }
  await handleStatus(parts.nodeId, parts.farmId, parsedStatus.data);
}

// ── Part 8 + Part 9 always-on loops (one process for all background work) ──
const offlineSweepTimer = startOfflineSweep();
const schedulerTimer = startIrrigationScheduler();

async function shutdown(signal: string): Promise<void> {
  console.log(`[mqtt-ingest] ${signal} received — shutting down`);
  clearInterval(offlineSweepTimer);
  clearTimeout(schedulerTimer);
  try {
    client.end(true);
    await pool.end();
  } catch (err) {
    console.error("[mqtt-ingest] error during shutdown:", err);
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`[mqtt-ingest] starting (broker: ${BROKER_URL}, pool reuse: shared with API)`);
