import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";

/**
 * Authentication service — capability-based model.
 * roles: 'farmer' | 'technician' (client, org-scoped) | 'admin' (platform staff, org NULL).
 * Deactivated users (is_active=false) can no longer log in; historical
 * attribution rows are preserved untouched.
 */

export type Role = "farmer" | "technician" | "admin";
export type Language = "en" | "fr" | "ar";
export type Theme = "dark" | "light";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /** NULL for admins — they belong to no single organization. */
  orgId: string | null;
  /** The specific farm a farmer operates. NULL for staff (admin/technician)
   *  and admins — only the farmer role carries a concrete farm_id. */
  farmId: string | null;
  /** Per-user UI language (applies immediately after login). */
  language: Language;
  /** Per-user UI theme. */
  theme: Theme;
}

export interface AccessContext {
  orgId: string | null;
  /** The specific farm a farmer is scoped to; NULL for staff/admin. */
  farmId: string | null;
  /** TRUE for both admin and technician — platform-scoped, no home org. */
  isStaff: boolean;
}

export function accessContextOf(user: AuthUser): AccessContext {
  return {
    orgId: user.orgId,
    farmId: user.farmId,
    isStaff: user.role === "admin" || user.role === "technician",
  };
}

const JWT_SECRET = process.env.JWT_SECRET ?? "";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const SESSION_COOKIE = "agrigate_session";

if (!JWT_SECRET) {
  console.warn("[auth] ⚠ JWT_SECRET is not set — login will fail until it is configured");
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

/** Verifies email/password and returns a signed JWT + user profile. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const result = await pool.query<Row>(
    `SELECT id, email, full_name, role, password_hash, org_id, farm_id, language, theme, is_active
     FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  // Uniform error whether the email exists, the password is wrong, or the
  // account was deactivated — never leak which is which.
  const genericError = new Error("Invalid email or password");

  if (result.rowCount === 0) {
    await bcrypt.compare(password, "$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQ0F5uP0o2fRkG0eYXJbQnVWz/u");
    throw genericError;
  }

  const row = result.rows[0];
  const passwordOk = await bcrypt.compare(password, row.password_hash ?? "");
  if (!passwordOk || !row.is_active) throw genericError;

  const user: AuthUser = rowToAuthUser(row);

  const token = jwt.sign(
    { userId: user.id, role: user.role, orgId: user.orgId, farmId: user.farmId },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );

  return { token, user };
}

interface Row {
  id: string;
  email: string;
  full_name: string;
  role: string;
  password_hash?: string;
  org_id: string | null;
  farm_id: string | null;
  language: string;
  theme: string;
  is_active: boolean;
}

function rowToAuthUser(row: Row): AuthUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as Role,
    orgId: row.org_id,
    farmId: row.farm_id,
    language: row.language === "fr" || row.language === "ar" ? row.language : "en",
    theme: row.theme === "light" ? "light" : "dark",
  };
}

/** Verifies a JWT and resolves its current user from the database. */
export async function verifyToken(token: string): Promise<AuthUser> {
  const payload = jwt.verify(token, JWT_SECRET) as { userId?: string; sub?: string };
  const userId = payload.userId ?? payload.sub;
  if (!userId) throw new Error("Malformed token");

  const result = await pool.query<Row>(
    `SELECT id, email, full_name, role, org_id, farm_id, language, theme, is_active
     FROM users WHERE id = $1`,
    [userId]
  );
  if (
    result.rowCount === 0 ||
    !result.rows[0].is_active // deactivated staff/client accounts lose access instantly
  ) {
    throw new Error("User no longer exists");
  }

  return rowToAuthUser(result.rows[0]);
}

/**
 * Platform-admin-only user directory. Client-role users excluded? No —
 * admins see everyone, including which org each client user belongs to.
 */
export async function listUsers(): Promise<
  { id: string; email: string; fullName: string; role: Role; orgId: string | null; farmId: string | null; isActive: boolean }[]
> {
  const result = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    role: string;
    org_id: string | null;
    farm_id: string | null;
    is_active: boolean;
  }>(
    `SELECT id, email, full_name, role, org_id, farm_id, is_active
     FROM users
     ORDER BY role = 'admin' DESC, role DESC, email ASC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as Role,
    orgId: row.org_id,
    farmId: row.farm_id,
    isActive: row.is_active,
  }));
}

// ── Farm-scoped user administration (farm settings panel) ──────────────────

export interface CreateUserInput {
  orgId: string;
  email: string;
  password: string;
  fullName: string;
  /** Farm-admins may only invite field operators or technicians. */
  role: Exclude<Role, "admin">;
  /** Required for farmer role (a farmer operates ONE specific farm).
   *  Null for technician (platform-scoped, org-less). */
  farmId: string | null;
}

export class DuplicateUserError extends Error {
  constructor(email: string) {
    super(`Email ${email} is already registered`);
    this.name = "DuplicateUserError";
  }
}

/** Creates a client-side user (farmer/technician only) inside one organization. */
export async function createUser(input: CreateUserInput): Promise<AuthUser & { isActive: boolean }> {
  // Validate the farm belongs to the org when a farmer is being created.
  if (input.role === "farmer") {
    if (!input.farmId) {
      throw new Error("A farmer account requires a specific farmId");
    }
    const farm = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM farms WHERE id = $1`,
      [input.farmId]
    );
    if (farm.rowCount === 0) throw new Error("Farm not found");
    if (farm.rows[0].org_id !== input.orgId) {
      throw new Error("farmId does not belong to orgId");
    }
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const result = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    role: string;
    org_id: string | null;
    farm_id: string | null;
  }>(
    `
    INSERT INTO users (org_id, farm_id, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, full_name, role, org_id, farm_id
    `,
    [
      input.orgId,
      input.role === "farmer" ? input.farmId : null,
      input.email.toLowerCase().trim(),
      passwordHash,
      input.fullName,
      input.role,
    ]
  );
  if (result.rowCount === 0) throw new DuplicateUserError(input.email);

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as Role,
    orgId: row.org_id,
    farmId: row.farm_id,
    language: "en",
    theme: "dark",
    isActive: true,
  };
}

export type DeleteUserResult =
  | "deleted"
  | "not_found"
  | "is_admin"
  | "org_mismatch"
  | "deactivated_already";

/**
 * Farm-settings remove flow: DEACTIVATE rather than hard-delete so
 * acknowledged_by / triggered_by attribution survives (Part 14).
 * Repeated deletes on an already-deactivated user report not_found.
 */
export async function deactivateUserInOrg(
  userId: string,
  orgId: string
): Promise<DeleteUserResult> {
  const existing = await pool.query<{ org_id: string | null; role: string; is_active: boolean }>(
    `SELECT org_id, role, is_active FROM users WHERE id = $1`,
    [userId]
  );
  if (existing.rowCount === 0) return "not_found";

  const target = existing.rows[0];
  if (target.role === "admin") return "is_admin";
  if ((target.org_id ?? "") !== orgId) return "org_mismatch";
  if (!target.is_active) return "deleted"; // already deactivated — treat as success/no-op

  const result = await pool.query(
    `UPDATE users SET is_active = FALSE WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2 RETURNING id`,
    [userId, orgId]
  );
  return (result.rowCount ?? 0) > 0 ? "deleted" : "not_found";
}

/** Farm-admin view: all client-side users of one organization. */
export async function listUsersForOrg(orgId: string): Promise<
  { id: string; email: string; fullName: string; role: Role; farmId: string | null; isActive: boolean }[]
> {
  const result = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    role: string;
    farm_id: string | null;
    is_active: boolean;
  }>(
    `SELECT id, email, full_name, role, farm_id, is_active
     FROM users
     WHERE org_id = $1
     ORDER BY role DESC, email ASC`,
    [orgId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as Role,
    farmId: row.farm_id,
    isActive: row.is_active,
  }));
}

/** Updates the authenticated user's OWN preferences (language/theme). */
export async function updateUserPreferences(
  userId: string,
  prefs: { language?: Language; theme?: Theme }
): Promise<AuthUser> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (prefs.language !== undefined) {
    values.push(prefs.language);
    sets.push(`language = $${values.length}`);
  }
  if (prefs.theme !== undefined) {
    values.push(prefs.theme);
    sets.push(`theme = $${values.length}`);
  }

  values.push(userId);
  const idIndex = values.length;

  const result = await pool.query<Row>(
    `UPDATE users
        SET ${sets.length > 0 ? sets.join(", ") + ", " : ""}updated_at = NOW()
      WHERE id = $${idIndex}
      RETURNING id, email, full_name, role, org_id, farm_id, language, theme, is_active`,
    values
  );
  if (result.rowCount === 0) throw new Error("User not found");

  return rowToAuthUser(result.rows[0]);
}
