import { pool } from "../db/pool";
import type { AuthUser } from "../auth/authService";

/**
 * Audit trail for cross-farm staff actions.
 *
 * Both 'admin' and 'technician' roles have org_id = NULL (platform-scoped),
 * so every write they make is on someone else's farm by definition. One row
 * per successful write, capturing the acting staff user + target farm +
 * what was done. Separate from per-record attribution fields
 * (acknowledged_by / triggered_by), which store the real acting user id.
 *
 * Audit failures are logged but never block the underlying operation.
 */
export async function logStaffAction(
  user: Pick<AuthUser, "id" | "role">,
  farmId: string,
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  // Only platform-scoped roles (admin, technician) are audited here.
  if (user.role !== "admin" && user.role !== "technician") return;
  try {
    await pool.query(
      `
      INSERT INTO staff_actions_log (staff_user_id, farm_id, action, details, role)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      `,
      [user.id, farmId, action, details ? JSON.stringify(details) : null, user.role]
    );
  } catch (err) {
    console.error(`[audit] 💥 failed to record "${action}" by ${user.id} on farm ${farmId}:`, err);
  }
}
