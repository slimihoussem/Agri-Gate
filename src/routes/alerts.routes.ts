import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import { alertIdParamsSchema } from "../schemas/alert.schema";
import * as alertService from "../services/alertService";
import { accessContextOf } from "../auth/authService";
import { assertEntityFarmAccess } from "../auth/tenancy";
import { requirePermission } from "../auth/authMiddleware";
import * as auditService from "../services/auditService";

/**
 * Mounted at /api/alerts in server.ts:
 *   PATCH /api/alerts/:alertId/acknowledge — capability alerts.ack
 *
 * The acknowledging operator comes from the authenticated session
 * (req.user.id), never a body-supplied placeholder. Tenant gate applies.
 */
const router = Router();

router.patch(
  "/:alertId/acknowledge",
  requirePermission("alerts.ack"),
  validateRequest({ source: "params", schema: alertIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ownerFarmId = await alertService.getAlertFarmId(req.params.alertId);
    const ctx = accessContextOf(req.user!);
    await assertEntityFarmAccess(ctx, ownerFarmId, "alert", req.params.alertId);
    const result = await alertService.acknowledgeAlert(req.params.alertId, req.user!.id);

    // Cross-tenant admin writes land in the audit trail.
    if (ctx.isStaff && ownerFarmId) {
      await auditService.logStaffAction(req.user!, ownerFarmId, "alert_acknowledged", {
        alertId: req.params.alertId,
      });
    }
    res.json(result);
  })
);

export default router;
