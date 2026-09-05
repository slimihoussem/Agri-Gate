import { z } from "zod";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import { accessContextOf } from "../auth/authService";
import { assertFarmAccess } from "../auth/tenancy";
import { requirePermission } from "../auth/authMiddleware";
import * as nodeService from "../services/nodeService";
import * as zoneLifecycleService from "../services/zoneLifecycleService";
import { pool } from "../db/pool";

/**
 * Mounted at /api/zones in server.ts.
 *
 *   GET /api/zones/:zoneId/nodes — the zone-expand UI's data source
 *   (Part 9 ext: irrigation control is per-node, so the frontend drills
 *   zone → nodes instead of assuming one actuator per zone).
 */
const router = Router();

const zoneIdParamsSchema = z.object({
  zoneId: z.string().uuid("zoneId must be a valid UUID"),
});

/** GET /api/zones/:zoneId — zone identity + counts (Screen 2 header / Screen 1 cards). */
router.get(
  "/:zoneId",
  validateRequest({ source: "params", schema: zoneIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const info = await zoneLifecycleService.getZoneInfo(req.params.zoneId);
    if (!info) {
      res.status(404).json({ error: `Zone ${req.params.zoneId} not found` });
      return;
    }
    await assertFarmAccess(ctx, info.farmId, "zone");
    res.json(info);
  })
);

/**
 * PATCH /api/zones/:zoneId — technician+ (editing details is lower-stakes
 * than structural create/remove). `active` is the archive/reactivate lever.
 */
const zonePatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  cropType: z.string().trim().min(1).max(255).optional(),
  targetMoisture: z.number().min(0).max(100).optional(),
  soilType: z.string().trim().max(255).optional(),
  areaHectares: z.number().min(0).max(100000).optional(),
  boundaryGps: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/:zoneId",
  requirePermission("zones.edit"),
  validateRequest({ source: "params", schema: zoneIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const farmId = await zoneLifecycleService.getZoneFarmId(req.params.zoneId);
    if (!farmId) {
      res.status(404).json({ error: `Zone ${req.params.zoneId} not found` });
      return;
    }
    await assertFarmAccess(ctx, farmId, "zone");
    await zoneLifecycleService.updateZone(
      req.params.zoneId,
      req.body as Parameters<typeof zoneLifecycleService.updateZone>[1]
    );
    const info = await zoneLifecycleService.getZoneInfo(req.params.zoneId);
    res.json(info);
  })
);

/** DELETE /api/zones/:zoneId — admin; node-count guard + history-aware lifecycle. */
router.delete(
  "/:zoneId",
  requirePermission("zones.edit"),
  validateRequest({ source: "params", schema: zoneIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const farmId = await zoneLifecycleService.getZoneFarmId(req.params.zoneId);
    if (!farmId) {
      res.status(404).json({ error: `Zone ${req.params.zoneId} not found` });
      return;
    }
    await assertFarmAccess(ctx, farmId, "zone");
    res.json(await zoneLifecycleService.deleteZoneWithLifecycle(req.params.zoneId));
  })
);

/** GET /api/zones/:zoneId/nodes — strictly this zone's nodes (server-side filter). */
const zoneNodesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

router.get(
  "/:zoneId/nodes",
  validateRequest({ source: "params", schema: zoneIdParamsSchema }),
  asyncHandler(async (req, res) => {
    // Tenant gate: resolve the zone's owning farm first.
    const zone = await pool.query<{ farm_id: string }>(
      `SELECT farm_id FROM zones WHERE id = $1`,
      [req.params.zoneId]
    );
    if (zone.rowCount === 0) {
      res.status(404).json({ error: `Zone ${req.params.zoneId} not found` });
      return;
    }
    await assertFarmAccess(accessContextOf(req.user!), zone.rows[0].farm_id, "zone");

    const query = req.query as unknown as { includeInactive?: boolean };
    // Server-side scope: the SQL itself filters by zone_id (+ archived unless opted in).
    const nodes = await nodeService.getNodesByZone(
      req.params.zoneId,
      query.includeInactive === true
    );
    res.json(nodes);
  })
);

export default router;

