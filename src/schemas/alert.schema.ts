import { z } from "zod";

export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const alertIdParamsSchema = z.object({
  alertId: z.string().uuid("alertId must be a valid UUID"),
});

export const alertStatusQuerySchema = z.object({
  status: z.enum(["active", "acknowledged"]).optional(),
});

// Part 10: the old body-supplied `userId` placeholder is gone — the
// acknowledging operator now comes from the authenticated session (req.user).

export const alertDtoSchema = z.object({
  id: z.string().uuid(),
  farmId: z.string().uuid(),
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  nodeId: z.string().nullable(),
  type: z.string(),
  severity: alertSeveritySchema,
  message: z.string(),
  value: z.string().nullable(),
  triggeredAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  acknowledged: z.boolean(),
});
export type AlertDto = z.infer<typeof alertDtoSchema>;
