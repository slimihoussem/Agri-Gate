import { pool } from "../db/pool";
import { HttpError } from "../middleware/errorHandler";
import type { AccessContext } from "./authService";

/**
 * Tenant isolation — Part 10 extension (+ per-farm farmer scoping).
 *
 * Client users are locked to the organization their account belongs to, and
 * a FARMER is additionally locked to their OWN single farm (farm_id). This is
 * the critical distinction the schema enforces: while an org may own many
 * farms, a farmer operates exactly one — so a farmer must never see another
 * farm in the same org.
 *
 * Rules:
 *   farm missing                      → 404 (don't leak existence)
 *   farmer + not their own farm       → 403
 *   technician/admin + explicit farm  → allowed (platform staff, org-less);
 *                                        may act on any farm they name.
 */

export async function getFarmOrgId(farmId: string): Promise<string | null> {
  const result = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM farms WHERE id = $1`,
    [farmId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].org_id;
}

/**
 * Throws 404/403 unless `ctx` may read the given farm. Call this before any
 * handler that returns farm-scoped data, and before entity-scoped mutations
 * after resolving the entity's owning farm.
 */
export async function assertFarmAccess(
  ctx: AccessContext,
  farmId: string,
  label = "farm"
): Promise<void> {
  const orgId = await getFarmOrgId(farmId);
  if (orgId === null) {
    throw HttpError.notFound(`${label === "farm" ? "Farm" : label} ${farmId} not found`);
  }
  // Staff (admin/technician) may access any farm they explicitly name.
  if (ctx.isStaff) return;
  // A farmer is locked to their OWN farm — org membership alone is NOT enough.
  if (ctx.farmId !== null && ctx.farmId === farmId) return;
  throw new HttpError(
    403,
    "Forbidden — this resource belongs to a different farm"
  );
}

/** Same check for entities that carry a denormalized org through their farm. */
export async function assertEntityFarmAccess(
  ctx: AccessContext,
  ownerFarmId: string | null,
  entityLabel: string,
  entityId: string
): Promise<void> {
  if (ownerFarmId === null) {
    // Entity not attached to a farm (e.g. orphaned alert) — only staff may touch it.
    if (!ctx.isStaff) {
      throw new HttpError(403, `Forbidden — ${entityLabel} ${entityId} is not linked to your organization`);
    }
    return;
  }
  await assertFarmAccess(ctx, ownerFarmId, entityLabel);
}
