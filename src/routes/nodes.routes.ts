import { z } from "zod";
import { Router } from "express";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import {
  createNodeBodySchema,
  nodeIdParamsSchema,
} from "../schemas/node.schema";
import {
  createNodeScheduleBodySchema,
  nodeStartBodySchema,
  nodeStopBodySchema,
} from "../schemas/irrigation.schema";
import * as nodeService from "../services/nodeService";
import * as irrigationService from "../services/irrigationService";
import * as telemetryService from "../services/telemetryService";
import { requirePermission } from "../auth/authMiddleware";
import { accessContextOf } from "../auth/authService";
import { assertFarmAccess } from "../auth/tenancy";
import { configTopic, publishNodeConfig, publishDiagnosticPing } from "../irrigation/commandPublisher";
import { pool } from "../db/pool";
import * as settingsService from "../settings/settingsService";
import { SettingsValidationError } from "../settings/settingsService";

/**
 * Mounted at /api/nodes in server.ts.
 *
 * Gates (capability model):
 *   GET    any authenticated role (own-org scoped)
 *   POST / PATCH / DELETE / reactivate        → nodes.edit
 *   POST   /:nodeId/irrigation/schedules      → irrigation.manage
 *   POST   /:nodeId/irrigation/start|stop     → irrigation.manage
 *   GET    …schedules|status|logs|telemetry    → auth only
 *   PATCH/DELETE /:nodeId/settings            → thresholds.edit
 */
const router = Router();

const nodeIrrigationParamsSchema = z.object({
  nodeId: z.string().min(1).max(50),
});

// ── reads ───────────────────────────────────────────────────────────────────

router.get(
  "/:nodeId",
  validateRequest({ source: "params", schema: nodeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const node = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(accessContextOf(req.user!), node.farmId, "node");
    res.json(node);
  })
);

router.get(
  "/:nodeId/irrigation/schedules",
  validateRequest({ source: "params", schema: nodeIrrigationParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    res.json(await irrigationService.getSchedulesByNode(req.params.nodeId, ctx));
  })
);

router.get(
  "/:nodeId/irrigation/status",
  validateRequest({ source: "params", schema: nodeIrrigationParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    res.json(await irrigationService.getNodeIrrigationStatus(req.params.nodeId, ctx));
  })
);

router.get(
  "/:nodeId/irrigation/logs",
  validateRequest({ source: "params", schema: nodeIrrigationParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    res.json(await irrigationService.getLogsByNode(req.params.nodeId, ctx));
  })
);

router.get(
  "/:nodeId/telemetry",
  validateRequest(
    { source: "params", schema: nodeIdParamsSchema },
    { source: "query", schema: z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) }) }
  ),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const node = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, node.farmId, "node");
    const query = req.query as unknown as { hours: number };
    res.json(await telemetryService.getNodeTelemetryHistory(node.id, query.hours));
  })
);

// ── mutations ───────────────────────────────────────────────────────────────

router.post(
  "/",
  requirePermission("nodes.edit"),
  validateRequest({ source: "body", schema: createNodeBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof nodeService.createNode>[0];
    await assertFarmAccess(accessContextOf(req.user!), body.farmId, "farm");
    const created = await nodeService.createNode(body);
    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, body.farmId, "node_created", { nodeId: created.id, name: created.name })
    );
    res.status(201).json(created);
  })
);

const nodePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    zoneId: z.string().uuid("zoneId must be a valid UUID").nullable().optional(),
    commMethod: z.enum(["wifi"]).optional(),
    mqttClientId: z.string().trim().min(1).max(50).optional(),
    read_interval_ms: z.number().int().min(1000).max(3_600_000).nullable().optional(),
    isActuator: z.boolean().optional(),
    // DEPRECATED — legacy 0-100 placeholder position, superseded by lat/lon.
    mapX: z.number().min(0).max(100).optional(),
    mapY: z.number().min(0).max(100).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    sensorCapabilities: z.array(z.enum(["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"])).min(1).optional(),
    flowRateLPerMin: z.number().positive().max(500).nullable().optional(),
    maxRuntimeMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    installedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date").nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

router.patch(
  "/:nodeId",
  requirePermission("nodes.edit"),
  validateRequest({ source: "params", schema: nodeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const body = req.body as Record<string, unknown> & {
      read_interval_ms?: number | null;
    };

    // Tenant gate BEFORE mutation.
    const existing = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, existing.farmId, "node");

    const updated = await nodeService.updateNodeExtended(req.params.nodeId, body as never, ctx);

    // Retained firmware-config sync when cadence (or safety runtime) changed.
    let configDelivered: boolean | undefined;
    let configTopicStr: string | undefined;
    let failureReason: string | undefined;
    if (body.read_interval_ms !== undefined || body.maxRuntimeMinutes !== undefined) {
      const farmOrg = await pool.query<{ org_id: string }>(
        `SELECT f.org_id FROM farms f WHERE f.id = $1`,
        [updated.farmId]
      );
      const cfg = await publishNodeConfig({
        nodeId: updated.id,
        orgId: farmOrg.rows[0]?.org_id ?? "",
        farmId: updated.farmId,
        payload: {
          readIntervalMs: updated.readIntervalMs ?? null,
          maxRuntimeMinutes: updated.maxRuntimeMinutes ?? null,
        },
      });
      configDelivered = cfg.delivered;
      configTopicStr = configTopic(farmOrg.rows[0]?.org_id ?? "", updated.farmId, updated.id);
      failureReason = cfg.delivered ? undefined : cfg.error;
    }

    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, updated.farmId, "node_edited", {
        nodeId: updated.id,
        fields: Object.keys(body),
      })
    );

    res.json({
      ...updated,
      ...(configDelivered !== undefined
        ? { configDelivered, configTopic: configTopicStr, failureReason }
        : {}),
    });
  })
);

router.delete(
  "/:nodeId",
  requirePermission("nodes.edit"),
  validateRequest({ source: "params", schema: nodeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const existing = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, existing.farmId, "node");
    const result = await nodeService.deleteNodeArchival(req.params.nodeId, ctx);
    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, existing.farmId, "node_removed", {
        nodeId: req.params.nodeId,
        mode: result.mode,
      })
    );
    res.json(result);
  })
);

router.post(
  "/:nodeId/reactivate",
  requirePermission("nodes.edit"),
  validateRequest({ source: "params", schema: nodeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const node = await nodeService.reactivateNode(req.params.nodeId);
    await assertFarmAccess(ctx, node.farmId, "node");
    res.json(node);
  })
);

// ── per-node irrigation control ─────────────────────────────────────────────

router.post(
  "/:nodeId/irrigation/schedules",
  requirePermission("irrigation.manage"),
  validateRequest({ source: "body", schema: createNodeScheduleBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof irrigationService.createScheduleForNode>[1];
    const created = await irrigationService.createScheduleForNode(req.params.nodeId, body);
    const farmId = await nodeService.getNodeById(req.params.nodeId).then((n) => n.farmId);
    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, farmId, "schedule_created", { nodeId: req.params.nodeId, scheduleId: created.id })
    );
    res.status(201).json(created);
  })
);

router.get(
  "/:nodeId/irrigation/schedules",
  validateRequest({ source: "params", schema: nodeIrrigationParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    res.json(await irrigationService.getSchedulesByNode(req.params.nodeId, ctx));
  })
);

router.get(
  "/:nodeId/irrigation/status",
  validateRequest({ source: "params", schema: nodeIrrigationParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    res.json(await irrigationService.getNodeIrrigationStatus(req.params.nodeId, ctx));
  })
);

router.post(
  "/:nodeId/irrigation/start",
  requirePermission("irrigation.manage"),
  validateRequest({ source: "body", schema: nodeStartBodySchema }),
  asyncHandler(async (req, res) => {
    // Open-ended manual open: the body is empty (see nodeStartBodySchema) —
    // no duration is requested or sent to the valve.
    const outcome = await irrigationService.startNodeIrrigation(
      req.params.nodeId,
      undefined,
      req.user!.id,
      accessContextOf(req.user!)
    );
    const farmId = await nodeService
      .getNodeById(req.params.nodeId)
      .then((n) => n.farmId)
      .catch(() => "");
    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, farmId, "irrigation_started", {
        nodeId: req.params.nodeId,
        openEnded: true,
        delivered: outcome.delivered,
      })
    );
    res.status(201).json(outcome);
  })
);

router.post(
  "/:nodeId/irrigation/stop",
  requirePermission("irrigation.manage"),
  validateRequest({ source: "params", schema: nodeIrrigationParamsSchema }),
  validateRequest({ source: "body", schema: nodeStopBodySchema }),
  asyncHandler(async (req, res) => {
    const force = req.body.force === true;
    const node = await nodeService.getNodeById(req.params.nodeId);
    const isZoneValve = node.isZoneValve === true;
    const roleIsStaff = req.user!.role === "technician" || req.user!.role === "admin";

    // Zone valves get the FARM-wide rule (at least one zone valve open across
    // the whole farm at all times). Regular field-node actuators keep the
    // per-zone rule. A zone valve never runs the per-zone check (it is unique
    // per zone, so a per-zone "last one" test has no analogous meaning).
    let guard: { blocked: boolean; reason?: string; zoneName?: string | null };
    if (isZoneValve) {
      const farmGuard = await irrigationService.checkFarmZoneValveBlock(node.farmId, req.params.nodeId);
      guard = farmGuard.blocked
        ? { blocked: true, reason: "last_open_zone_valve_in_farm" }
        : { blocked: false };
    } else {
      const zoneGuard = await irrigationService.checkLastRunningValveBlock(req.params.nodeId);
      guard = zoneGuard.blocked
        ? { blocked: true, reason: "last_running_valve_in_zone", zoneName: zoneGuard.zoneName }
        : { blocked: false };
    }

    // Farmer (or any unforced caller) closing the LAST valve → distinct
    // blocked response, not a generic 400.
    if (guard.blocked && !force) {
      return res.status(409).json({
        blocked: true,
        reason: guard.reason,
        ...(guard.reason === "last_running_valve_in_zone" ? { zoneName: guard.zoneName ?? "this zone" } : {}),
      });
    }

    // force=true from a non-staff role is still rejected — the backend is the
    // real enforcement point, the UI is only cosmetics.
    if (guard.blocked && force && !roleIsStaff) {
      return res.status(403).json({
        blocked: true,
        reason: "force_close_forbidden",
        error:
          guard.reason === "last_open_zone_valve_in_farm"
            ? "Only technicians and admins may force-close the last open zone valve on the farm."
            : "Only technicians and admins may force-close the last running valve in a zone.",
      });
    }

    const outcome = await irrigationService.stopNodeIrrigation(
      req.params.nodeId,
      accessContextOf(req.user!)
    );

    // A force that actually bypassed the safety rule is auditable.
    if (guard.blocked && force) {
      await import("../services/auditService").then((m) =>
        m.logStaffAction(req.user!, node.farmId,
          guard.reason === "last_open_zone_valve_in_farm" ? "force_close_last_zone_valve" : "force_close_last_valve",
          {
            nodeId: req.params.nodeId,
            ...(guard.zoneName ? { zoneName: guard.zoneName } : {}),
            reason: guard.reason,
          })
      );
    }
    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, node.farmId, "irrigation_stopped", { nodeId: req.params.nodeId })
    );
    res.json(outcome);
  })
);

// ── diagnostic ping (Part 15) ───────────────────────────────────────────────

router.post(
  "/:nodeId/ping",
  validateRequest({ source: "params", schema: nodeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const node = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, node.farmId, "node");

    const farmOrg = await pool.query<{ org_id: string }>(
      `SELECT f.org_id FROM farms f WHERE f.id = $1`,
      [node.farmId]
    );

    const outcome = await publishDiagnosticPing({
      nodeId: node.id,
      orgId: farmOrg.rows[0]?.org_id ?? "",
      farmId: node.farmId,
    });

    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, node.farmId, "node_pinged", { nodeId: node.id, delivered: outcome.delivered })
    );

    res.json({
      nodeId: node.id,
      delivered: outcome.delivered,
      topic: outcome.delivered ? outcome.topic : undefined,
      logId: outcome.logId,
      failureReason: outcome.delivered ? undefined : outcome.error,
      note: outcome.delivered
        ? "Ping sent via MQTT broker. A response confirms the node is online and subscribed to commands."
        : undefined,
    });
  })
);

// ── per-node threshold overrides ────────────────────────────────────────────

const nodeSettingsKeyParamsSchema = z.object({
  nodeId: z.string().min(1).max(50),
  key: z.string().min(1).max(100),
});

const nodeSettingPatchSchema = z
  .record(z.string(), z.number())
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one setting to update",
  });

router.get(
  "/:nodeId/settings",
  validateRequest({ source: "params", schema: nodeIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const node = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, node.farmId, "node");
    res.json(await settingsService.getEffectiveThresholds(req.params.nodeId));
  })
);

router.patch(
  "/:nodeId/settings",
  requirePermission("thresholds.edit"),
  validateRequest({ source: "body", schema: nodeSettingPatchSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const node = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, node.farmId, "node");
    const body = req.body as Record<string, number>;
    try {
      for (const [key, value] of Object.entries(body)) {
        await settingsService.updateNodeSetting(req.params.nodeId, key, value, req.user!.id);
      }
      const effective = await settingsService.getEffectiveThresholds(req.params.nodeId);
      await import("../services/auditService").then((m) =>
        m.logStaffAction(req.user!, node.farmId, "threshold_updated", {
          nodeId: req.params.nodeId,
          keys: Object.keys(body),
        })
      );
      res.json(effective);
    } catch (err) {
      if (err instanceof SettingsValidationError) throw new HttpError(400, err.message);
      throw err;
    }
  })
);

router.delete(
  "/:nodeId/settings/:key",
  requirePermission("thresholds.edit"),
  validateRequest({ source: "params", schema: nodeSettingsKeyParamsSchema }),
  asyncHandler(async (req, res) => {
    const ctx = accessContextOf(req.user!);
    const node = await nodeService.getNodeById(req.params.nodeId);
    await assertFarmAccess(ctx, node.farmId, "node");
    await settingsService.deleteNodeSetting(req.params.nodeId, req.params.key);
    await import("../services/auditService").then((m) =>
      m.logStaffAction(req.user!, node.farmId, "threshold_reset", {
        nodeId: req.params.nodeId,
        key: req.params.key,
      })
    );
    res.json(await settingsService.getEffectiveThresholds(req.params.nodeId));
  })
);

export default router;
