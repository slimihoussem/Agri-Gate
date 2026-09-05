import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireStaff } from "../auth/authMiddleware";
import * as adminService from "../services/adminService";

/**
 * Staff farms listing — Part 14 amendment.
 * Available to BOTH admin and technician (both are platform-scoped staff).
 * Returns per-farm operational stats so technicians can triage where to work.
 *
 * This is different emphasis from GET /api/admin/orgs (which is client-
 * management oriented). Here we expose operational fields only.
 */
const router = Router();

router.get(
  "/farms",
  requireStaff,
  asyncHandler(async (_req, res) => {
    const orgs = await adminService.listOrgsWithFarmStats();
    const result = orgs.flatMap((org) =>
      org.farms.map((farm) => ({
        farmId: farm.farmId,
        farmName: farm.farmName,
        orgName: org.orgName,
        nodeCount: farm.nodeCount,
        activeNodeCount: farm.activeNodeCount,
        offlineNodeCount: Math.max(0, farm.nodeCount - farm.activeNodeCount),
        openAlertCount: farm.openAlertCount,
      }))
    );
    res.json(result);
  })
);

export default router;
