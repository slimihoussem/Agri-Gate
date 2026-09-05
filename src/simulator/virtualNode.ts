import mqtt, { MqttClient } from "mqtt";
import {
  telemetryPayloadSchema,
  TelemetryPayload,
  statusPayloadSchema,
} from "../mqtt/schemas/telemetryPayload.schema";
import { microclimateAt, hourOfDayOf, nextSoilMoisture } from "./diurnalModel";
import { commandsTopic } from "../irrigation/commandPublisher";

/**
 * One virtual ESP32 node — Part 6.
 *
 * Own MQTT connection, own connection-reliability state machine, and an
 * in-memory buffer mirroring the real firmware's SPIFFS retry queue
 * (shrunk from 10,000 to 100 entries for dev testing).
 *
 * The buffer/retry behavior here is the PROTOTYPE that Part 5's real
 * firmware will copy: readings are timestamped at GENERATION time and
 * flushed in chronological order on reconnect, so downstream analytics
 * see the true measurement moment — never the flush moment.
 */

export const BUFFER_CAP = 100;
const FLUSH_DELAY_MS = 60; // 50–100ms pacing so ingestion isn't burst-hit

export interface VirtualNodeConfig {
  nodeId: string;
  name: string;
  orgId: string;
  farmId: string;
  zoneName: string | null;
  clientId: string;
  brokerUrl: string;
  intervalMs: number;
  unreliableWifi: boolean;
  /** Part 9: designated valve driver — listens on its /commands topic. */
  isActuator: boolean;
  /** Seed anchors so simulated values continue seamlessly from DB history. */
  batteryStart: number;
  rssiBase: number;
  moistureBase: number;
}

interface BufferedReading {
  payload: TelemetryPayload;
}

export class VirtualNode {
  private readonly cfg: VirtualNodeConfig;
  private client: MqttClient;

  /** Simulated WiFi link state (independent of the real MQTT connection). */
  private linkUp = true;
  private buffer: BufferedReading[] = [];
  private timer: NodeJS.Timeout | null = null;

  // Mutable sensor state
  private moisture: number;
  private nitrogen: number;
  private phosphorus: number;
  private potassium: number;
  private battery: number;

  // Part 9: actuator state
  private irrigationTimer: NodeJS.Timeout | null = null;
  private activeLogId: string | null = null;

  constructor(cfg: VirtualNodeConfig, nutrientBaseline?: { nitrogen: number | null; phosphorus: number | null; potassium: number | null }) {
    this.cfg = cfg;
    this.moisture = cfg.moistureBase;
    this.battery = cfg.batteryStart;
    this.nitrogen = nutrientBaseline?.nitrogen ?? 220;
    this.phosphorus = nutrientBaseline?.phosphorus ?? 50;
    this.potassium = nutrientBaseline?.potassium ?? 180;
    this.client = this.connect();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    // Small random phase offset so nodes don't fire in lock-step.
    const jitter = Math.floor(Math.random() * Math.min(2000, this.cfg.intervalMs));
    this.timer = setInterval(() => void this.cycle().catch(this.logError), this.cfg.intervalMs);
    setTimeout(() => void this.cycle().catch(this.logError), jitter);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.irrigationTimer) clearTimeout(this.irrigationTimer);
    await new Promise<void>((resolve) => this.client.end(false, {}, () => resolve()));
  }

  private connect(): MqttClient {
    const client = mqtt.connect(this.cfg.brokerUrl, {
      clientId: this.cfg.clientId,
      clean: true,
      reconnectPeriod: 3000,
    });
    client.on("error", (err) =>
      console.error(`[NODE ${this.cfg.nodeId}] ❌ mqtt error: ${err.message}`)
    );

    // Part 9: actuators listen for valve commands on their own topic.
    if (this.cfg.isActuator) {
      client.on("connect", () => {
        const topic = commandsTopic(this.cfg.orgId, this.cfg.farmId, this.cfg.nodeId);
        client.subscribe(topic, { qos: 1 }, (err) => {
          if (err) {
            console.error(`[NODE ${this.cfg.nodeId}] ❌ command subscription failed: ${err.message}`);
          } else {
            console.log(`[NODE ${this.cfg.nodeId}] 🎛 actuator ready — subscribed to ${topic}`);
          }
        });
      });
      client.on("message", (_topic, payloadBuffer) => this.handleCommand(payloadBuffer));
    }

    return client;
  }

  /**
   * Simulated relay firmware. Real contract:
   *   { "action": "irrigate_start", "durationMinutes"?: n, "logId": uuid }
   *   { "action": "irrigate_stop", "logId": uuid }
   *
   * durationMinutes is OPTIONAL by design:
   *   - present (> 0): programmed run — the valve self-closes after that
   *     many minutes (used by scheduled recurring/one-time irrigation).
   *   - absent: open-ended run — the valve stays open with NO safety timer
   *     until the server sends `irrigate_stop`. Manual Open sends no
   *     duration, so the device must never force-close on its own.
   */
  private handleCommand(payloadBuffer: Buffer): void {
    let parsed: { action?: string; durationMinutes?: number; logId?: string };
    try {
      parsed = JSON.parse(payloadBuffer.toString("utf8"));
    } catch {
      console.error(`[NODE ${this.cfg.nodeId}] ❌ invalid command payload (not JSON)`);
      return;
    }

    if (parsed.action === "irrigate_start") {
      const durationMinutes =
        parsed.durationMinutes !== undefined && Number.isFinite(parsed.durationMinutes)
          ? Math.max(1, Math.round(parsed.durationMinutes))
          : undefined;
      this.activeLogId = parsed.logId ?? null;

      if (this.irrigationTimer) clearTimeout(this.irrigationTimer);

      if (durationMinutes !== undefined) {
        console.log(
          `[NODE ${this.cfg.name}] IRRIGATION STARTED — programmed run, self-closes after ${durationMinutes} min`
        );
        this.irrigationTimer = setTimeout(() => {
          void this.completeIrrigation();
        }, durationMinutes * 60_000);
      } else {
        console.log(
          `[NODE ${this.cfg.name}] IRRIGATION STARTED — OPEN-ENDED, runs until irrigate_stop (no safety cutoff)`
        );
      }
      return;
    }

    if (parsed.action === "irrigate_stop") {
      console.log(`[NODE ${this.cfg.name}] received irrigate_stop — closing valve early`);
      if (this.irrigationTimer) clearTimeout(this.irrigationTimer);
      void this.completeIrrigation();
      return;
    }

    console.warn(`[NODE ${this.cfg.nodeId}] ⚠ unknown command action "${parsed.action}"`);
  }

  /** Cycle finished → report completion on the Part 4 status topic. */
  private completeIrrigation(): void {
    if (this.activeLogId === null) return;
    const status = {
      online: true,
      irrigationComplete: true as const,
      logId: this.activeLogId,
    };
    const check = statusPayloadSchema.safeParse(status);
    if (!check.success) {
      console.error(`[NODE ${this.cfg.nodeId}] 💥 completion status failed validation`);
      return;
    }

    const topic = `agrigate/${this.cfg.orgId}/${this.cfg.farmId}/${this.cfg.nodeId}/status`;
    const logId = this.activeLogId;
    this.client.publish(topic, JSON.stringify(check.data), { qos: 1 }, () => {
      console.log(`[NODE ${this.cfg.name}] IRRIGATION COMPLETE (log ${logId})`);
    });
    this.activeLogId = null;
  }

  // ── main loop ────────────────────────────────────────────────────────────

  private async cycle(): Promise<void> {
    const now = new Date();

    // 1. Generate the reading FIRST — its timestamp is the measurement time
    //    and must survive any buffering detour untouched.
    const payload = this.generateReading(now);

    // 2. Roll the simulated connection state machine.
    this.rollConnection();

    // 3. Route.
    if (this.linkUp) {
      if (this.buffer.length > 0) {
        await this.flush(); // reconnect path: drain backlog first
      }
      await this.publish(payload);
    } else {
      if (this.buffer.length >= BUFFER_CAP) {
        // Ring behaviour like full SPIFFS: oldest reading is overwritten.
        this.buffer.shift();
        console.warn(
          `[NODE ${this.cfg.nodeId}] ⚠ buffer FULL (${BUFFER_CAP}) — dropped oldest reading`
        );
      }
      this.buffer.push({ payload });
      console.log(
        `${this.logPrefix(payload)} BUFFERED (n=${this.buffer.length} queued)`
      );
    }
  }

  private generateReading(now: Date): TelemetryPayload {
    const hourOfDay = hourOfDayOf(now);
    const climate = microclimateAt(now);

    this.moisture = nextSoilMoisture(this.moisture, hourOfDay);

    // Slow drain so long runs eventually cross low-battery thresholds (~0.01%/cycle).
    this.battery = Math.max(0, Math.round((this.battery - 0.01) * 100) / 100);

    // Nutrients drift very slowly around their baseline.
    this.nitrogen = drift(this.nitrogen, 0.4);
    this.phosphorus = drift(this.phosphorus, 0.2);
    this.potassium = drift(this.potassium, 0.5);

    const rssi = this.cfg.rssiBase + Math.round(Math.random() * 6 - 3); // ±3 dBm band

    return {
      soilMoisture: this.moisture,
      nitrogen: Math.round(this.nitrogen),
      phosphorus: Math.round(this.phosphorus),
      potassium: Math.round(this.potassium),
      soilTemp: climate.soilTemp,
      airTemp: climate.airTemp,
      airHumidity: climate.humidity,
      battery: this.battery,
      rssi,
      timestamp: now.toISOString(),
    };
  }

  // ── simulated connection reliability ─────────────────────────────────────

  /**
   * Per cycle: 90% chance of keeping the current link state, 10% of flipping.
   * This produces multi-cycle outages — the case buffering exists for.
   */
  private rollConnection(): void {
    if (!this.cfg.unreliableWifi) {
      if (!this.linkUp) {
        this.linkUp = true;
        console.log(`[NODE ${this.cfg.nodeId}] connection RESTORED (reliable mode)`);
      }
      return;
    }
    if (Math.random() < 0.1) {
      this.linkUp = !this.linkUp;
      if (!this.linkUp) {
        console.log(`[NODE ${this.cfg.nodeId}] connection LOST — entering buffered mode`);
      } else {
        console.log(
          `[NODE ${this.cfg.nodeId}] connection RESTORED — flushing ${this.buffer.length} buffered reading(s)`
        );
      }
    }
  }

  // ── publishing ───────────────────────────────────────────────────────────

  private topic(): string {
    return `agrigate/${this.cfg.orgId}/${this.cfg.farmId}/${this.cfg.nodeId}/telemetry`;
  }

  private publish(reading: BufferedReading["payload"]): Promise<void> {
    // Defensive: never emit a contract violation, even by accident.
    const check = telemetryPayloadSchema.safeParse(reading);
    if (!check.success) {
      console.error(
        `[NODE ${this.cfg.nodeId}] 💥 generated an INVALID payload — dropped locally: ` +
          check.error.errors.map((i) => i.message).join("; ")
      );
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.client.publish(this.topic(), JSON.stringify(check.data), { qos: 1 }, () => resolve());
    });
  }

  private async flush(): Promise<void> {
    while (this.buffer.length > 0) {
      const oldest = this.buffer.shift()!;
      await delay(FLUSH_DELAY_MS + Math.random() * 40);
      await this.publish(oldest.payload);
      console.log(
        `${this.logPrefix(oldest.payload)} FLUSHED (buffer→${this.buffer.length}) ts=${oldest.payload.timestamp}`
      );
    }
  }

  // ── logging ──────────────────────────────────────────────────────────────

  /** One line, readable at a glance across 5–6 simultaneous nodes. */
  private logPrefix(payload: TelemetryPayload): string {
    return (
      `[NODE ${this.cfg.nodeId}] ${this.cfg.name} | ` +
      `💧${(payload.soilMoisture ?? 0).toFixed(1)}% 🌡${(payload.soilTemp ?? 0).toFixed(1)}°C ` +
      `🔋${payload.battery.toFixed(1)}% 📶${payload.rssi}dBm`
    );
  }

  private logError = (err: unknown): void => {
    console.error(`[NODE ${this.cfg.nodeId}] 💥 cycle error:`, err);
  };
}

function drift(value: number, magnitude: number): number {
  const next = value + Math.random() * magnitude * 2 - magnitude;
  return Math.max(0, next);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
