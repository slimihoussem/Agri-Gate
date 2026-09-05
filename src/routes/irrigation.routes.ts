import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import {
  scheduleIdParamsSchema,
  updateScheduleBodySchema,
} from "../schemas/irrigation.schema";
import * as irrigationService from "../services/irrigationService";
import { requirePermission } from "../auth/authMiddleware";
import { accessContextOf } from "../auth/authService";

/**
 * Mounted at /api/irrigation in server.ts:
 *   PATCH  /api/irrigation/schedules/:id      (technician or admin — Part 10)
 *   POST   /api/irrigation/schedules/:id/start (any authenticated role)
 *   DELETE /api/irrigation/schedules/:id      (Part 017 — one_time removal)
 * Part 10 ext: all are tenant-gated to the schedule's owning farm.
 */
const router = Router();

router.patch(
  "/schedules/:id",
  requirePermission("irrigation.manage"),
  validateRequest(
    { source: "params", schema: scheduleIdParamsSchema },
    { source: "body", schema: updateScheduleBodySchema }
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof irrigationService.updateSchedule>[1];
    const ctx = accessContextOf(req.user!);
    res.json(await irrigationService.updateSchedule(req.params.id, body, ctx));
  })
);

router.post(
  "/schedules/:id/start",
  requirePermission("irrigation.manage"),
  validateRequest({ source: "params", schema: scheduleIdParamsSchema }),
  asyncHandler(async (req, res) => {
    // Manual trigger is any-role, but the ACTING USER is recorded from the
    // session (Part 10) instead of the old body-supplied placeholder.
    const ctx = accessContextOf(req.user!);
    const created = await irrigationService.startScheduleNow(
      req.params.id,
      req.user!.id,
      ctx
    );
    res.status(201).json(created);
  })
);

router.delete(
  "/schedules/:id",
  requirePermission("irrigation.manage"),
  validateRequest({ source: "params", schema: scheduleIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const farmId = await irrigationService
      .getScheduleFarmId(req.params.id, ctx)
      .catch(() => "");
    await irrigationService.deleteSchedule(req.params.id, ctx);
    if (farmId) {
      await import("../services/auditService").then((m) =>
        m.logStaffAction(req.user!, farmId, "schedule_deleted", {
          scheduleId: req.params.id,
        })
      );
    }
    res.status(204).end();
  })
);

export default router;

