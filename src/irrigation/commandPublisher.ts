import mqtt, { MqttClient } from "mqtt";
import { randomUUID } from "crypto";

/**
 * Actuator command publisher — Part 9.
 *
 * Publishes irrigation commands to a node's command topic:
 *   agrigate/{orgId}/{farmId}/{nodeId}/commands
 *
 * Owns a LAZY singleton MQTT connection so it works in whichever process
 * imports it: the ingest/scheduler process AND the Part 3 HTTP API process
 * (manual trigger route). Publish results are wrapped in an explicit
 * discriminated result type — callers decide how to persist failures.
 *
 * MQTT contract for the (future real) relay ESP32:
 *   Start: { "action": "irrigate_start", "durationMinutes"?: n, "logId": uuid }
 *          durationMinutes is OPTIONAL — omitted = open-ended run that stays
 *          open until `irrigate_stop` (manual Open); present = programmed
 *          run the device self-closes (scheduled irrigation).
 *   Stop:  { "action": "irrigate_stop", "logId": uuid }
 */

export type IrrigationAction = "irrigate_start" | "irrigate_stop";

export type CommandPublishResult =
  | { delivered: true }
  | { delivered: false; error: string };

/** Simulated hydraulic output used when completion is reported (Part 9). */
export const SIMULATED_FLOW_L_PER_MIN = 16;

const CONNECT_TIMEOUT_MS = 5_000;
/** QoS 1 publish ack timeout — broker down must surface as failure, not hang. */
const PUBLISH_ACK_TIMEOUT_MS = 5_000;

let client: MqttClient | null = null;

function getClient(): Promise<MqttClient> {
  if (client && client.connected) return Promise.resolve(client);

  const brokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1884";
  client = mqtt.connect(brokerUrl, {
    clientId: `agrigate-cmdpub-${process.pid}`,
    clean: true,
    reconnectPeriod: 0, // we manage retry per-publish; no background reconnect loop
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  client.on("error", () => {
    /* errors surface through connect/publish timeouts below */
  });

  // Ensure stale sockets don't linger forever between publishes.
  client.on("close", () => {
    /* keep the client object; next getClient() reconnects because connected=false */
  });

  return new Promise<MqttClient>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("broker unreachable")), CONNECT_TIMEOUT_MS);
    const cleanup = (): void => clearTimeout(timeout);
    client!.once("connect", () => {
      cleanup();
      resolve(client!);
    });
    client!.once("error", (err) => {
      cleanup();
      reject(err);
    });
  }).catch((err) => {
    // Reset so the next attempt starts fresh.
    try {
      client?.end(true);
    } catch {
      /* ignore */
    }
    client = null;
    throw err;
  });
}

export async function publishIrrigationCommand(params: {
  nodeId: string;
  orgId: string;
  farmId: string;
  action: IrrigationAction;
  durationMinutes?: number;
  logId: string;
}): Promise<CommandPublishResult> {
  const topic = `agrigate/${params.orgId}/${params.farmId}/${params.nodeId}/commands`;
  const payloadObj: Record<string, unknown> = { action: params.action, logId: params.logId };
  if (params.durationMinutes !== undefined) {
    payloadObj.durationMinutes = params.durationMinutes;
  }
  const payload = JSON.stringify(payloadObj);

  let connectedClient: MqttClient;
  try {
    connectedClient = await getClient();
  } catch (err) {
    console.error(
      `[cmd-publisher] ✗ could not reach broker for ${topic}: ${(err as Error).message}`
    );
    return { delivered: false, error: "Command delivery failed — broker unreachable" };
  }

  return new Promise<CommandPublishResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ delivered: false, error: "Command delivery failed — broker acknowledgement timed out" });
    }, PUBLISH_ACK_TIMEOUT_MS);

    connectedClient.publish(topic, payload, { qos: 1 }, (err) => {
      clearTimeout(timeout);
      if (err) {
        console.error(`[cmd-publisher] ✗ ${topic}: ${err.message}`);
        resolve({ delivered: false, error: `Command delivery failed — ${err.message}` });
      } else {
        console.log(`[cmd-publisher] ✓ ${topic} ← ${payload}`);
        resolve({ delivered: true });
      }
    });
  });
}

export type PingAction = "ping";

export type PingPublishResult =
  | { delivered: true; logId: string; topic: string }
  | { delivered: false; error: string; logId: string };

/**
 * Diagnostic ping — Part 15.
 *
 * Publishes a `{ "action": "ping", "logId", "sentAt" }` helper message to the
 * node's command topic so an online subscriber (the simulator's VirtualNode,
 * or the future relay firmware) replies with a pong on its .../status topic.
 *
 * The HTTP caller gets a synchronous delivery confirmation (broker accepted
 * it, QoS 1); it does NOT wait for the node's pong — that round-trip is
 * observed via the node's heartbeat/status, mirroring the irrigation
 * start/stop delivery pattern. A `logId` is returned so a follow-up could
 * correlate a matching pong.
 */
export async function publishDiagnosticPing(params: {
  nodeId: string;
  orgId: string;
  farmId: string;
}): Promise<PingPublishResult> {
  const logId = randomUUID();
  const topic = `agrigate/${params.orgId}/${params.farmId}/${params.nodeId}/commands`;
  const payloadObj = { action: "ping", logId, sentAt: new Date().toISOString() };
  const payload = JSON.stringify(payloadObj);

  let connectedClient: MqttClient;
  try {
    connectedClient = await getClient();
  } catch (err) {
    console.error(
      `[cmd-publisher] ✗ could not reach broker for ${topic}: ${(err as Error).message}`
    );
    return { delivered: false, error: "Ping delivery failed — broker unreachable", logId };
  }

  return new Promise<PingPublishResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ delivered: false, error: "Ping delivery failed — broker acknowledgement timed out", logId });
    }, PUBLISH_ACK_TIMEOUT_MS);

    connectedClient.publish(topic, payload, { qos: 1 }, (err) => {
      clearTimeout(timeout);
      if (err) {
        console.error(`[cmd-publisher] ✗ ${topic}: ${err.message}`);
        resolve({ delivered: false, error: `Ping delivery failed — ${err.message}`, logId });
      } else {
        console.log(`[cmd-publisher] ✓ ${topic} ← ${payload}`);
        resolve({ delivered: true, logId, topic });
      }
    });
  });
}

export function commandsTopic(orgId: string, farmId: string, nodeId: string): string {
  return `agrigate/${orgId}/${farmId}/${nodeId}/commands`;
}

export function configTopic(orgId: string, farmId: string, nodeId: string): string {
  return `agrigate/${orgId}/${farmId}/${nodeId}/config`;
}

// ── Part 11: node configuration topic (RETAINED) ────────────────────────────

/**
 * Publishes a RETAINED config message so the node picks up new settings
 * live AND on next boot if it was offline at publish time.
 *
 * ⚠ FIRMWARE NOTE (Part 5): MqttConnection must SUBSCRIBE to this topic on
 * every connect and apply `readIntervalMs` AT RUNTIME when a message
 * arrives — not just read READ_INTERVAL_MS once from config.h at boot.
 */
export async function publishNodeConfig(params: {
  nodeId: string;
  orgId: string;
  farmId: string;
  payload: Record<string, unknown>;
}): Promise<CommandPublishResult> {
  const topic = `agrigate/${params.orgId}/${params.farmId}/${params.nodeId}/config`;
  let connectedClient: MqttClient;
  try {
    connectedClient = await getClient();
  } catch (err) {
    console.error(
      `[cmd-publisher] ✗ could not reach broker for ${topic}: ${(err as Error).message}`
    );
    return { delivered: false, error: "Config delivery failed — broker unreachable" };
  }

  return new Promise<CommandPublishResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ delivered: false, error: "Config delivery failed — broker acknowledgement timed out" });
    }, PUBLISH_ACK_TIMEOUT_MS);

    connectedClient.publish(topic, JSON.stringify(params.payload), { qos: 1, retain: true }, (err) => {
      clearTimeout(timeout);
      if (err) {
        console.error(`[cmd-publisher] ✗ ${topic} (retained): ${err.message}`);
        resolve({ delivered: false, error: `Config delivery failed — ${err.message}` });
      } else {
        console.log(`[cmd-publisher] ✓ ${topic} ← ${JSON.stringify(params.payload)} (retained)`);
        resolve({ delivered: true });
      }
    });
  });
}
