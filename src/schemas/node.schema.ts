import { z } from "zod";

/** Part 4 will add LoRaWAN etc.; for now wifi is the only transport. */
export const commMethodSchema = z.enum(["wifi"]);
export const nodeStatusSchema = z.enum(["online", "warning", "offline"]);

export const nodeIdParamsSchema = z.object({
  nodeId: z.string().min(1, "nodeId is required").max(50),
});

/** Part 13 ext: the 7 valid sensor capability keys. */
export const SENSOR_CAPABILITIES = [
  "soilMoisture",
  "nitrogen",
  "phosphorus",
  "potassium",
  "soilTemp",
  "airTemp",
  "airHumidity",
] as const;
export type SensorCapability = (typeof SENSOR_CAPABILITIES)[number];

export const sensorCapabilitiesSchema = z
  .array(z.enum(SENSOR_CAPABILITIES))
  .min(1, "a node must report at least one sensor");

const latSchema = z.number().min(-90).max(90);
const lonSchema = z.number().min(-180).max(180);
const isoDateSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid ISO date");

export const createNodeBodySchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .optional()
    .describe("Hardware serial printed on the device; auto-generated when omitted"),
  farmId: z.string().uuid("farmId must be a valid UUID"),
  zoneId: z.string().uuid("zoneId must be a valid UUID").nullable().optional(),
  name: z.string().trim().min(1, "name is required").max(255),
  commMethod: commMethodSchema.default("wifi"),
  // DEPRECATED — legacy 0-100 placeholder position, superseded by lat/lon.
  mapX: z.number().min(0).max(100).optional(),
  mapY: z.number().min(0).max(100).optional(),
  // ── Part 13 ext ──
  lat: latSchema.optional(),
  lon: lonSchema.optional(),
  sensorCapabilities: sensorCapabilitiesSchema.optional(),
  mqttClientId: z
    .string()
    .trim()
    .min(1, "mqttClientId must not be empty")
    .max(50, "mqttClientId must be at most 50 characters")
    .optional(),
  flowRateLPerMin: z.number().positive().max(500).optional(),
  maxRuntimeMinutes: z.number().int().min(1).max(1440).optional(),
  installedAt: isoDateSchema.optional(),
  notes: z.string().max(2000).optional(),
  isActuator: z.boolean().default(false),
  /** Part 19: dedicated main-valve node for a zone (nullable-array default →
   *  the service forces is_actuator=true and sensor_capabilities=[]). */
  isZoneValve: z.boolean().optional(),
});
export type CreateNodeInput = z.infer<typeof createNodeBodySchema>;

export const nodeDtoSchema = z.object({
  id: z.string(),
  farmId: z.string().uuid(),
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  name: z.string(),
  commMethod: commMethodSchema,
  mqttClientId: z.string().nullable(),
  status: nodeStatusSchema,
  x: z.number().nullable(),
  y: z.number().nullable(),
  battery: z.number().nullable(),
  rssi: z.number().int().nullable(),
  lastSeen: z.string().nullable(),
  /** Part 11: per-node telemetry cadence override; null = farm default. */
  readIntervalMs: z.number().int().nullable(),
  /** Part 9 ext: designated valve driver for its zone (drives irrigation UI). */
  isActuator: z.boolean(),
  /** Part 19: dedicated main-valve node (one per zone, no sensors). */
  isZoneValve: z.boolean(),
  /** Part 14: archival flag — archived nodes hidden from default views. */
  active: z.boolean(),
  // ── Part 13 ext ──
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  sensorCapabilities: z.array(z.enum(SENSOR_CAPABILITIES)),
  flowRateLPerMin: z.number().nullable(),
  maxRuntimeMinutes: z.number().int().nullable(),
  installedAt: z.string().nullable(),
  notes: z.string().nullable(),
  // ── Part 017: latest telemetry snapshot (null before first report) ──
  moisture: z.number().nullable(),
  soilTemp: z.number().nullable(),
  ambientTemp: z.number().nullable(),
  humidity: z.number().nullable(),
});
export type NodeDto = z.infer<typeof nodeDtoSchema>;
