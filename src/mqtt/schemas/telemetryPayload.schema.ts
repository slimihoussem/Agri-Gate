import { z } from "zod";

/**
 * ─── MQTT PAYLOAD CONTRACT (Part 4) ────────────────────────────────────────
 * nodeId is NEVER trusted from the body — it is extracted from the topic
 * (4th segment) by ingest.ts before these schemas are applied.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Published to agrigate/{orgId}/{farmId}/{nodeId}/telemetry.
 *
 * Only battery + rssi are always required. Every sensor field is OPTIONAL and
 * driven by the node's `nodes.sensor_capabilities`: a node that does not
 * advertise a capability (e.g. one with only soilMoisture+soilTemp) simply
 * omits that field. Handlers write the absent fields as NULL.
 */
export const telemetryPayloadSchema = z.object({
  soilMoisture: z.number().min(0).max(100).optional(),
  nitrogen: z.number().min(0).max(2000).optional(),
  phosphorus: z.number().min(0).max(2000).optional(),
  potassium: z.number().min(0).max(2000).optional(),
  soilTemp: z.number().min(-50).max(80).optional(),
  airTemp: z.number().min(-50).max(80).optional(),
  airHumidity: z.number().min(0).max(100).optional(),
  battery: z.number().min(0).max(100),
  rssi: z.number().int().min(-120).max(0),
  /** ISO 8601 — OPTIONAL; server receive time is used when absent. */
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

/**
 * Heartbeat published to agrigate/{orgId}/{farmId}/{nodeId}/status.
 * Kept in this same module because it is part of the single MQTT payload
 * contract and is intentionally tiny.
 *
 * Part 9: actuators append `irrigationComplete` + `logId` when a commanded
 * cycle finishes, which closes out the matching irrigation_logs row.
 */
export const statusPayloadSchema = z.object({
  online: z.boolean(),
  /** Redundant heartbeat info — persisted when present. */
  battery: z.number().min(0).max(100).optional(),
  irrigationComplete: z.boolean().optional(),
  logId: z.string().uuid("logId must be a valid UUID").optional(),
}).refine(
  (v) => !v.irrigationComplete || v.logId !== undefined,
  { message: "irrigationComplete status requires logId" }
);
export type StatusPayload = z.infer<typeof statusPayloadSchema>;
