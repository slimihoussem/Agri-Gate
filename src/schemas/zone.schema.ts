import { z } from "zod";

/**
 * Zone status is COMPUTED server-side (single source of truth in
 * zoneService.computeZoneStatus). The frontend only renders whatever
 * status value arrives here — it must never re-derive thresholds.
 */
export const zoneStatusSchema = z.enum(["ok", "warning", "critical", "disconnected"]);
export type ZoneStatus = z.infer<typeof zoneStatusSchema>;

export const farmIdParamsSchema = z.object({
  farmId: z.string().uuid("farmId must be a valid UUID"),
});

export const zoneSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  cropType: z.string(),
  targetMoisture: z.number(),
  moisture: z.number().nullable(),
  nitrogen: z.number().nullable(),
  phosphorus: z.number().nullable(),
  potassium: z.number().nullable(),
  status: zoneStatusSchema,
  activeNodeCount: z.number().int().nonnegative(),
  activeScheduleCount: z.number().int().nonnegative(),
  /** Total nodes assigned to the zone (all lifecycle states). */
  nodeCount: z.number().int().nonnegative(),
  /** Active actuator (valve) nodes in the zone — zone must keep ≥1 for water control. */
  activeActuatorCount: z.number().int().nonnegative(),
  /** Part 19: this zone has a dedicated main-valve node configured. */
  hasZoneValve: z.boolean(),
  /** Part 19: the zone's main valve is CURRENTLY open (open, unskipped run). */
  zoneValveRunning: z.boolean(),
  /** Part 13 ext: lifecycle flag — archived zones hidden from default views. */
  active: z.boolean(),
  /** Raw ISO 8601 timestamp — relative formatting ("2h ago") is a frontend concern. */
  lastWatered: z.string().nullable(),
  /** GPS map page: per-zone boundary within the farm (null if never drawn). */
  boundaryGps: z.unknown().nullable(),
  /** Stored area in hectares — auto-calculated/backfilled server-side. */
  areaHectares: z.number().nullable(),
});
export type ZoneSummary = z.infer<typeof zoneSummarySchema>;
