import { z } from "zod";
import { Router } from "express";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import { requireAdminUser } from "../auth/authMiddleware";
import { accessContextOf, createUser as userServiceCreateUser } from "../auth/authService";
import type { AccessContext } from "../auth/authService";
import { assertFarmAccess } from "../auth/tenancy";
import { listUsers } from "../auth/authService";
import * as adminService from "../services/adminService";
import * as auditService from "../services/auditService";
import * as farmService from "../services/farmService";
import { pool } from "../db/pool";

/**
 * Platform-admin console API — Part 12 ext.
 * Every route gated by requireAdminUser (role === 'admin', hard check).
 *
 *   GET    /api/admin/overview              platform-wide aggregate COUNTs
 *   GET    /api/admin/orgs                  orgs + nested per-farm stats (?includeInactive=true)
 *   GET    /api/admin/farms/:farmId/users   users of a farm's org (Manage Users panel)
 *   POST   /api/admin/users                 create farmer/technician on existing org+farm
 *   DELETE /api/admin/users/:userId         deactivate user (history preserved)
 *   PATCH  /api/admin/farms/:farmId         edit farm details / reassign org
 *   DELETE /api/admin/farms/:farmId         archive-or-hard-delete farm
 *   POST   /api/admin/orgs/:orgId/farms     add a farm to an EXISTING org
 *   DELETE /api/admin/orgs/:orgId           delete org only when empty (400 otherwise)
 */
const router = Router();

// ── Overview ────────────────────────────────────────────────────────────────

router.get(
  "/overview",
  requireAdminUser,
  asyncHandler(async (_req, res) => {
    res.json(await adminService.getPlatformOverview());
  })
);

// ── Organizations ───────────────────────────────────────────────────────────

router.get(
  "/orgs",
  requireAdminUser,
  validateRequest({
    source: "query",
    schema: z.object({
      includeInactive: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    }),
  }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { includeInactive: boolean };
    res.json(await adminService.listOrgsWithFarmStats(query.includeInactive));
  })
);

// ── Users ───────────────────────────────────────────────────────────────────

const createAdminUserBodySchema = z.object({
  role: z.enum(["farmer", "technician"]),
  orgId: z.string().uuid(),
  farmId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(255),
  email: z.string().trim().email(),
  temporaryPassword: z.string().min(8),
});

const deactivateUserParamsSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
});

router.get(
  "/farms/:farmId/users",
  requireAdminUser,
  validateRequest({ source: "params", schema: z.object({ farmId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const ctx: AccessContext = accessContextOf(req.user!);
    await assertFarmAccess(ctx, req.params.farmId, "farm");
    const org = await pool.query<{ org_id: string; name: string }>(
      `SELECT org_id, name FROM farms WHERE id = $1`,
      [req.params.farmId]
    );
    if (org.rowCount === 0) throw HttpError.notFound(`Farm ${req.params.farmId} not found`);
    // Per-FARM user list: a farmer belongs to EXACTLY one farm, so this panel
    // only shows farmers of the SELECTED farm + org-level technicians (who span
    // every farm in the org). This prevents the cross-contamination where
    // selecting farm 2 also displayed farm 1's farmer (org-wide query).
    const users = await pool.query(
      `SELECT id, email, full_name, role, farm_id, is_active
       FROM users
       WHERE role <> 'admin'
         AND (
           (role = 'farmer' AND farm_id = $1)
           OR
           (role = 'technician' AND org_id = $2)
         )
       ORDER BY role DESC, email`,
      [req.params.farmId, org.rows[0].org_id]
    );
    res.json({
      farmId: req.params.farmId,
      orgId: org.rows[0].org_id,
      orgName: org.rows[0].name,
      users: users.rows.map((u: any) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
        isActive: u.is_active,
      })),
    });
  })
);

router.post(
  "/users",
  requireAdminUser,
  validateRequest({ source: "body", schema: createAdminUserBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      role: "farmer" | "technician"; orgId: string; farmId: string;
      fullName: string; email: string; temporaryPassword: string;
    };
    await assertFarmAccess(accessContextOf(req.user!), body.farmId, "farm");
    const created = await userServiceCreateUser({
      orgId: body.orgId,
      farmId: body.role === "farmer" ? body.farmId : null,
      email: body.email,
      password: body.temporaryPassword,
      fullName: body.fullName,
      role: body.role,
    });
    await auditService.logStaffAction(req.user!, body.farmId, "user_created", {
      userId: created.id, email: body.email, role: body.role, farmId: body.farmId,
    });
    res.status(201).json({ id: created.id, temporaryPassword: body.temporaryPassword });
  })
);

// ── Part 14: edit user (name/email/active) ──────────────────────────────────

const patchUserBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email("email must be a valid address").optional(),
  active: z.boolean().optional(),
});

const patchUserParamsSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
});

router.patch(
  "/users/:userId",
  requireAdminUser,
  validateRequest(
    { source: "params", schema: patchUserParamsSchema },
    { source: "body", schema: patchUserBodySchema }
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { name?: string; email?: string; active?: boolean };
    const target = await pool.query<{ org_id: string | null; role: string }>(
      `SELECT org_id, role FROM users WHERE id = $1`,
      [req.params.userId]
    );
    if ((target.rowCount ?? 0) === 0) throw HttpError.notFound("User not found");
    if (target.rows[0].role === "admin") {
      throw new HttpError(400, "Admin accounts cannot be edited via this endpoint");
    }

    // Duplicate email check → clean 409
    if (body.email !== undefined) {
      const dup = await pool.query(
        `SELECT 1 FROM users WHERE email = $1 AND id <> $2`,
        [body.email.toLowerCase().trim(), req.params.userId]
      );
      if ((dup.rowCount ?? 0) > 0) {
        throw new HttpError(409, `Email ${body.email} is already in use by another account`);
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (v: unknown): string => { values.push(v); return `$${values.length}`; };
    if (body.name !== undefined) sets.push(`full_name = ${push(body.name)}`);
    if (body.email !== undefined) sets.push(`email = ${push(body.email.toLowerCase().trim())}`);
    if (body.active !== undefined) sets.push(`is_active = ${push(body.active)}`);
    if (sets.length === 0) throw new HttpError(400, "Provide at least one field to update");

    const result = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = ${push(req.params.userId)}
       RETURNING id, email, full_name, role, org_id, is_active`,
      values
    );

    res.json({
      id: result.rows[0].id,
      email: result.rows[0].email,
      fullName: result.rows[0].full_name,
      role: result.rows[0].role,
      isActive: result.rows[0].is_active ?? true,
    });
  })
);

router.delete(
  "/users/:userId",
  requireAdminUser,
  validateRequest({ source: "params", schema: deactivateUserParamsSchema }),
  asyncHandler(async (req, res) => {
    if (req.user!.id === req.params.userId) {
      throw new HttpError(400, "You cannot remove your own account");
    }
    const target = await pool.query<{ role: string; is_active: boolean }>(
      `SELECT role, is_active FROM users WHERE id = $1`, [req.params.userId]
    );
    if ((target.rowCount ?? 0) === 0) throw HttpError.notFound("User not found");
    if (target.rows[0].role === "admin") {
      throw new HttpError(400, "Admin accounts cannot be removed via this endpoint");
    }

    // Comprehensive history check across ALL FK/attribution sources.
    const historyCheck = await pool.query<{ total: number }>(
      `
      SELECT (
        (SELECT COUNT(*)::int FROM alerts WHERE acknowledged_by = $1)
        + (SELECT COUNT(*)::int FROM staff_actions_log WHERE staff_user_id = $1)
        + (SELECT COUNT(*)::int FROM settings WHERE updated_by = $1)
        + (SELECT COUNT(*)::int FROM node_settings WHERE updated_by = $1)
        + (SELECT COUNT(*)::int FROM irrigation_logs WHERE triggered_by = $1::text OR triggered_by = $2::text)
      ) AS total
      `,
      [req.params.userId, req.user!.id]
    );
    const totalRefs = Number(historyCheck.rows[0].total);

    if (totalRefs > 0) {
      // Archive: deactivate so they can't log in, preserve attribution.
      await pool.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [req.params.userId]);
      await auditService.logStaffAction(req.user!, "", "user_archived", {
        userId: req.params.userId,
        reason: "has historical references",
        referenceCount: totalRefs,
      });
      res.json({
        deleted: true,
        mode: "archived",
        reason: "Has historical activity — deactivated instead of deleted to preserve records",
        referenceCount: totalRefs,
      });
      return;
    }

    // Zero references → safe to hard delete.
    await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.userId]);
    await auditService.logStaffAction(req.user!, "", "user_deleted", { userId: req.params.userId });
    res.json({ deleted: true, mode: "hard" });
  })
);

// ── Add farm to existing org (Part 12 ext) ────────────────────────────────────

const addFarmToOrgBodySchema = z.object({
  farmName: z.string().trim().min(1, "farmName is required").max(255),
  location: z.string().trim().max(255).optional(),
  farmLat: z.number().min(-90).max(90).nullable().optional(),
  farmLon: z.number().min(-180).max(180).nullable().optional(),
});

const orgIdParams = z.object({
  orgId: z.string().uuid("orgId must be a valid UUID"),
});

router.post(
  "/orgs/:orgId/farms",
  requireAdminUser,
  validateRequest({ source: "params", schema: orgIdParams }),
  validateRequest({ source: "body", schema: addFarmToOrgBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      farmName: string;
      location?: string;
      farmLat?: number | null;
      farmLon?: number | null;
    };
    const result = await farmService.addFarmToOrganization({
      orgId: req.params.orgId,
      farmName: body.farmName,
      location: body.location,
      latitude: body.farmLat ?? null,
      longitude: body.farmLon ?? null,
    });
    await auditService.logStaffAction(req.user!, result.farm.id, "farm_added_to_org", {
      orgId: result.organization.id,
      farmName: body.farmName,
    });
    res.status(201).json(result);
  })
);

// ── Farm management (Part 12 ext) ───────────────────────────────────────────

const farmPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  orgId: z.string().uuid("orgId must be a valid UUID").optional(),
  centerLat: z.number().min(-90).max(90).nullable().optional(),
  centerLon: z.number().min(-180).max(180).nullable().optional(),
  totalAreaHa: z.number().min(0).max(100000).nullable().optional(),
  active: z.boolean().optional(),
});

const farmIdParams = z.object({
  farmId: z.string().uuid("farmId must be a valid UUID"),
});

router.patch(
  "/farms/:farmId",
  requireAdminUser,
  validateRequest({ source: "params", schema: farmIdParams }),
  validateRequest({ source: "body", schema: farmPatchSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof adminService.updateFarmAdmin>[1];
    const result = await adminService.updateFarmAdmin(req.params.farmId, body);
    if (result.reassigned) {
      await auditService.logStaffAction(req.user!, req.params.farmId, "farm_reassigned", {
        oldOrgId: result.oldOrgId,
        newOrgId: result.newOrgId,
      });
    }
    res.json(result);
  })
);

router.delete(
  "/farms/:farmId",
  requireAdminUser,
  asyncHandler(async (req, res) => {
    const result = await adminService.deleteFarmWithLifecycle(req.params.farmId);
    await auditService.logStaffAction(req.user!, req.params.farmId, "farm_removed", {
      mode: result.mode,
    });
    res.json(result);
  })
);

// ── Organization removal ─────────────────────────────────────────────────────

router.delete(
  "/orgs/:orgId",
  requireAdminUser,
  validateRequest({ source: "params", schema: orgIdParams }),
  asyncHandler(async (req, res) => {
    const result = await adminService.deleteOrgWithGuards(req.params.orgId);
    await auditService.logStaffAction(req.user!, "", "org_removed", {
      orgId: req.params.orgId,
      farmCount: result.farmCount,
      userCount: result.userCount,
    });
    res.json(result);
  })
);

export default router;
