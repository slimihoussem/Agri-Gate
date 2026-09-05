import { z } from "zod";

const timeOfDay = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/,
    "startTime must be HH:MM or HH:MM:SS (24h)"
  );

/** ISO 8601 date-time, e.g. 2026-09-01T06:00 or 2026-09-01T06:00:00.000Z */
const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?([+-]\d{2}:\d{2}|Z)?$/,
    "must be an ISO 8601 date-time (e.g. 2026-09-01T06:00)"
  );

export const scheduleIdParamsSchema = z.object({
  id: z.string().uuid("schedule id must be a valid UUID"),
});

export const updateScheduleBodySchema = z
  .object({
    startTime: timeOfDay.optional(),
    durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
    repeatDays: z
      .array(z.number().int().min(0, "0=Sunday").max(6, "6=Saturday"))
      .max(7)
      .optional(),
    moistureThreshold: z.number().min(0).max(100).optional(),
    active: z.boolean().optional(),
    scheduledStart: isoDateTime.optional(),
    scheduledEnd: isoDateTime.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.scheduledStart !== undefined || body.scheduledEnd !== undefined) {
      if (body.startTime !== undefined || body.repeatDays !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduledStart"],
          message:
            "cannot mix recurring (startTime/repeatDays) and one_time (scheduledStart/scheduledEnd) fields",
        });
      }
      const startRaw = body.scheduledStart ?? new Date().toISOString();
      const start = new Date(startRaw);
      const end = body.scheduledEnd ? new Date(body.scheduledEnd) : start;
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        if (end.getTime() <= start.getTime()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["scheduledEnd"],
            message: "scheduledEnd must be after scheduledStart",
          });
        }
      }
    } else if (Object.keys(body).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide at least one field to update",
      });
    }
  });
export type UpdateScheduleInput = z.infer<typeof updateScheduleBodySchema>;

// ── create: discriminated by scheduleType ───────────────────────────────────

const recurringScheduleSchema = z.object({
  scheduleType: z.literal("recurring"),
  startTime: timeOfDay,
  durationMinutes: z.number().int().min(1).max(24 * 60),
  repeatDays: z
    .array(z.number().int().min(0, "0=Sunday").max(6, "6=Saturday"))
    .min(1, "pick at least one day of week")
    .max(7),
  moistureThreshold: z.number().min(0).max(100),
  active: z.boolean().default(true),
});

const oneTimeScheduleSchema = z.object({
  scheduleType: z.literal("one_time"),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  /** Omit or null = always fire (skips the soil-moisture gate). */
  moistureThreshold: z.number().min(0).max(100).nullish(),
  active: z.boolean().default(true),
});

/**
 * Part 017: create either a recurring weekly schedule or a one-time dated
 * run. The service stores the one-time duration as scheduled_end − start.
 */
export const createNodeScheduleBodySchema = z
  .discriminatedUnion("scheduleType", [
    recurringScheduleSchema,
    oneTimeScheduleSchema,
  ])
  .superRefine((val, ctx) => {
    if (val.scheduleType !== "one_time") return;
    const start = new Date(val.scheduledStart);
    const end = new Date(val.scheduledEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEnd"],
        message: "scheduledStart/scheduledEnd must be valid ISO 8601 date-times",
      });
      return;
    }
    if (end.getTime() <= start.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEnd"],
        message: "scheduledEnd must be after scheduledStart",
      });
    }
    if (start.getTime() <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledStart"],
        message: "scheduledStart must be in the future",
      });
    }
  });
export type CreateNodeScheduleInput = z.infer<typeof createNodeScheduleBodySchema>;

/**
 * Manual OPEN is now OPEN-ENDED by design: the POST body is empty. No
 * duration is requested or sent to the device — the valve stays open until
 * the operator issues a manual Close. Scheduled irrigation (recurring /
 * one_time) still carries its own explicit duration via the scheduler.
 */
export const nodeStartBodySchema = z.object({}).strict();

/**
 * Manual CLOSE body. Normally empty (`{}`). The safety rule blocks closing the
 * last running valve in a zone unless a technician/admin sends
 * `{ force: true }` to bypass it (audited via staff_actions_log).
 */
export const nodeStopBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .strict();

export const irrigationScheduleDtoSchema = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  /** Part 9 ext: the specific actuator node this schedule drives. */
  nodeId: z.string().nullable(),
  nodeName: z.string().nullable(),
  /** Part 017: "recurring" or "one_time" (recurring is the pre-017 default). */
  scheduleType: z.enum(["recurring", "one_time"]),
  startTime: z.string().nullable(),
  durationMinutes: z.number().int(),
  repeatDays: z.array(z.number().int().min(0).max(6)),
  moistureThreshold: z.number().nullable(),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  firedAt: z.string().nullable(),
  active: z.boolean(),
});
export type IrrigationScheduleDto = z.infer<typeof irrigationScheduleDtoSchema>;

export const irrigationLogDtoSchema = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  /** Part 9 ext: which node executed the run. */
  nodeId: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  skipped: z.boolean(),
  skipReason: z.string().nullable(),
  waterUsedL: z.number(),
  triggeredBy: z.string(),
});
export type IrrigationLogDto = z.infer<typeof irrigationLogDtoSchema>;