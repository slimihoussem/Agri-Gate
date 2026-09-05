import { z } from "zod";
import { Router, RequestHandler } from "express";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import { farmIdParamsSchema } from "../schemas/zone.schema";
import { trendQuerySchema } from "../schemas/telemetry.schema";
import { alertStatusQuerySchema } from "../schemas/alert.schema";
import { accessContextOf } from "../auth/authService";
import { assertFarmAccess, getFarmOrgId } from "../auth/tenancy";
import { requirePermission, requireAdminUser } from "../auth/authMiddleware";
import * as auditService from "../services/auditService";
import {
  DuplicateUserError,
  createUser,
  deactivateUserInOrg,
  listUsersForOrg,
} from "../auth/authService";
import * as farmService from "../services/farmService";
import * as zoneService from "../services/zoneService";
import * as zoneLifecycleService from "../services/zoneLifecycleService";
import * as nodeService from "../services/nodeService";
import * as telemetryService from "../services/telemetryService";
import * as alertService from "../services/alertService";
import * as irrigationService from "../services/irrigationService";
import {
  getSettings,
  updateSettings,
  SettingsValidationError,
} from "../settings/settingsService";

/**
 * HTTP layer ONLY: extract validated params, call a service, return the
 * result. No SQL and no business logic here.
 *
 * Part 10 ext: every /:farmId route passes through requireFarmAccess —
 * client users are locked to their own organization; platform admins may
 * read any farm they explicitly name in the path.
 */
const router = Router();

/** Tenant check against the path farmId (runs AFTER param validation). */
const requireFarmAccess: RequestHandler = (req, res, next) => {
  assertFarmAccess(accessContextOf(req.user!), req.params.farmId)
    .then(() => next())
    .catch(next);
};

const validateFarmId: RequestHandler = validateRequest({
  source: "params",
  schema: farmIdParamsSchema,
});

const farmListQuerySchema = z.object({
  orgId: z.string().uuid("orgId must be a valid UUID").optional(),
});

router.get(
  "/",
  validateRequest({ source: "query", schema: farmListQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { orgId?: string };
    res.json(await farmService.listFarms(accessContextOf(req.user!), query.orgId));
  })
);

router.get(
  "/:farmId/dashboard",
  validateFarmId,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    res.json(await farmService.getDashboard(req.params.farmId));
  })
);

// ── zones.routes.ts content lives under the /api/farms mount ──
// Archived zones are EXCLUDED by default (?includeInactive=true opts in).
const zoneListQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

router.get(
  "/:farmId/zones",
  validateFarmId,
  requireFarmAccess,
  validateRequest({ source: "query", schema: zoneListQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { includeInactive: boolean };
    res.json(
      await zoneService.getZoneStatusesByFarm(req.params.farmId, query.includeInactive)
    );
  })
);

/** POST /api/farms/:farmId/zones — farm-admin level (structural change). */
const zoneCreateBodySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(255),
  cropType: z.string().trim().min(1, "cropType is required").max(255),
  targetMoisture: z.number().min(0).max(100),
  soilType: z.string().trim().max(255).optional(),
  areaHectares: z.number().min(0).max(100000).optional(),
  boundaryGps: z.record(z.string(), z.unknown()).optional(),
});

router.post(
  "/:farmId/zones",
  validateFarmId,
  requirePermission("zones.edit"),
  requireFarmAccess,
  validateRequest({ source: "body", schema: zoneCreateBodySchema }),
  asyncHandler(async (req, res) => {
    const newZoneId = await zoneLifecycleService.createZone(
      req.params.farmId,
      req.body as Parameters<typeof zoneLifecycleService.createZone>[1]
    );
    const info = await zoneLifecycleService.getZoneInfo(newZoneId);
    res.status(201).json(info);
  })
);

// ── nodes by farm (nodes.routes.ts also mounts /api/nodes separately) ──
const nodeListQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

router.get(
  "/:farmId/nodes",
  validateFarmId,
  requireFarmAccess,
  validateRequest({ source: "query", schema: nodeListQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { includeInactive: boolean };
    res.json(await nodeService.getNodesByFarm(req.params.farmId, query.includeInactive));
  })
);

// ── telemetry trend ──
router.get(
  "/:farmId/telemetry/trend",
  validateFarmId,
  requireFarmAccess,
  validateRequest({ source: "query", schema: trendQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { hours: number };
    res.json({
      zones: await telemetryService.getMoistureTrend(req.params.farmId, query.hours),
    });
  })
);

// ── alerts list (alerts.routes.ts also mounts /api/alerts) ──
router.get(
  "/:farmId/alerts",
  validateFarmId,
  requireFarmAccess,
  validateRequest({ source: "query", schema: alertStatusQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { status?: "active" | "acknowledged" };
    res.json(await alertService.getAlertsByFarm(req.params.farmId, query.status));
  })
);

// ── irrigation (irrigation.routes.ts also mounts /api/irrigation) ──
router.get(
  "/:farmId/irrigation/schedules",
  validateFarmId,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    res.json(await irrigationService.getSchedulesByFarm(req.params.farmId));
  })
);

router.get(
  "/:farmId/irrigation/logs",
  validateFarmId,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    res.json(await irrigationService.getLogsByFarm(req.params.farmId));
  })
);

// ── Part 11: configurable farm settings ─────────────────────────────────────
// VIEW: any authenticated role with access (read-only for farmer role).
// EDIT: technician or admin — enforced here, not by the UI.

router.get(
  "/:farmId/settings",
  validateFarmId,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    res.json(await getSettings(req.params.farmId));
  })
);

const settingsPatchSchema = z
  .record(z.string(), z.number())
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one setting to update",
  });

router.patch(
  "/:farmId/settings",
  validateFarmId,
  requirePermission("thresholds.edit"),
  requireFarmAccess,
  validateRequest({ source: "body", schema: settingsPatchSchema }),
  asyncHandler(async (req, res) => {
    try {
      const updated = await updateSettings(
        req.params.farmId,
        req.body as Record<string, number>,
        req.user!.id
      );
      res.json(updated);
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        throw new HttpError(400, err.message);
      }
      throw err;
    }
  })
);

// ── Part 11: farm administration (farm-admin level) ─────────────────────────

const updateUserParamsSchema = z.object({
  farmId: z.string().uuid("farmId must be a valid UUID"),
  userId: z.string().uuid("userId must be a valid UUID"),
});

const inviteUserBodySchema = z.object({
  email: z.string().trim().email("email must be a valid address"),
  password: z.string().min(8, "password must be at least 8 characters"),
  fullName: z.string().trim().min(1, "fullName is required").max(255),
  // A farm-admin cannot create another admin or a platform admin.
  role: z.enum(["farmer", "technician"]),
});

router.get(
  "/:farmId/users",
  validateFarmId,
  requireAdminUser,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    const orgId = await getFarmOrgId(req.params.farmId);
    if (!orgId) throw HttpError.notFound(`Farm ${req.params.farmId} not found`);
    res.json(await listUsersForOrg(orgId));
  })
);

router.post(
  "/:farmId/users",
  validateFarmId,
  requireAdminUser,
  requireFarmAccess,
  validateRequest({ source: "body", schema: inviteUserBodySchema }),
  asyncHandler(async (req, res) => {
    const orgId = await getFarmOrgId(req.params.farmId);
    if (!orgId) throw HttpError.notFound(`Farm ${req.params.farmId} not found`);

    try {
      const body = req.body as { email: string; password: string; fullName: string; role: "farmer" | "technician" };
      // Route-scoped farmId: a farmer invite pins the account to THIS farm.
      const user = await createUser({
        orgId,
        farmId: body.role === "farmer" ? req.params.farmId : null,
        ...body,
      });
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof DuplicateUserError) throw new HttpError(409, err.message);
      throw err;
    }
  })
);

router.delete(
  "/:farmId/users/:userId",
  validateRequest({ source: "params", schema: updateUserParamsSchema }),
  requireAdminUser,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    if (req.user!.id === req.params.userId) {
      throw new HttpError(400, "You cannot delete your own account");
    }
    const orgId = await getFarmOrgId(req.params.farmId);
    if (!orgId) throw HttpError.notFound(`Farm ${req.params.farmId} not found`);

    const result = await deactivateUserInOrg(req.params.userId, orgId);
    switch (result) {
      case "deleted":
        res.json({ ok: true });
        return;
      case "is_admin":
        throw new HttpError(400, "Platform administrator accounts cannot be removed here");
      case "org_mismatch":
        throw HttpError.notFound("User not found in this organization");
      case "not_found":
      default:
        throw HttpError.notFound("User not found in this organization");
    }
  })
);

// Farm identity edit — capability farmIdentity.edit (farmer + admin per
// the Part 14 model; technician no longer holds it).
const updateFarmBodySchema = z.object({
name: z.string().trim().min(1).max(255).optional(),
location: z.string().trim().max(255).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field to update" });

router.patch(
"/:farmId",
validateFarmId,
requirePermission("farmIdentity.edit"),
requireFarmAccess,
validateRequest({ source: "body", schema: updateFarmBodySchema }),
asyncHandler(async (req, res) => {
  const updated = await farmService.updateFarm(req.params.farmId, req.body as { name?: string; location?: string });
  await auditService.logStaffAction(
    req.user!,
    req.params.farmId,
    "farm_identity_updated",
    { ...(req.body as { name?: string; location?: string }) }
  );
  res.json(updated);
})
);

// ── GPS map VECTOR layer (farm boundary) ────────────────────────────────────
// Boundary drawing is a field-operations task → zones.edit (technician+admin),
// NOT farmIdentity.edit (farmer holds that) and NOT platform admin only. Zones
// and node repositioning on the same map use their own zones.edit / nodes.edit.

// Loose GeoJSON polygon shape (structure checked; coordinates are [lon, lat]).
const geojsonPolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.array(z.number()))).min(1),
  })
  .passthrough();

/** GET /api/farms/:farmId/spatial — farm boundary + center for the map (auth). */
router.get(
  "/:farmId/spatial",
  validateFarmId,
  requireFarmAccess,
  asyncHandler(async (req, res) => {
    res.json(await farmService.getFarmSpatial(req.params.farmId));
  })
);

const farmBoundaryPatchSchema = z
  .object({
    boundaryGeojson: geojsonPolygonSchema.optional(),
    centerLat: z.number().min(-90).max(90).nullable().optional(),
    centerLon: z.number().min(-180).max(180).nullable().optional(),
    // Client-computed farm area (ha) from the drawn polygon (turf.area/10000).
    totalAreaHa: z.number().min(0).max(1000000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "Provide at least one field to update",
  });

/** PATCH /api/farms/:farmId/boundary — save a drawn farm boundary (zones.edit). */
router.patch(
  "/:farmId/boundary",
  validateFarmId,
  requirePermission("zones.edit"),
  requireFarmAccess,
  validateRequest({ source: "body", schema: farmBoundaryPatchSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof farmService.updateFarmBoundary>[1];
    const updated = await farmService.updateFarmBoundary(req.params.farmId, body);
    await auditService.logStaffAction(req.user!, req.params.farmId, "farm_boundary_updated", {
      hasBoundary: body.boundaryGeojson !== undefined,
      setCenter: body.centerLat !== undefined || body.centerLon !== undefined,
    });
    res.json(updated);
  })
);

export default router;
