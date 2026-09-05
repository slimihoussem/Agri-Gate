/**
 * Part 14: admin user management endpoint tests (Tests 1-5).
 */
import * as dotenv from "dotenv";

dotenv.config();

import { pool } from "../src/db/pool";

const BASE = process.env.API_URL ?? "http://localhost:4000";
const farmId = "9cb3551b-8b18-428b-bff0-393778658f61";
let passCount = 0;
let failCount = 0;
let adminSession = "";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  session?: string
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(session ? { cookie: session } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function getSession(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status}`);
  const sc = res.headers.get("set-cookie") ?? "";
  const m = sc.match(/agrigate_session=([^;]+)/);
  if (!m) throw new Error(`no session cookie from ${email} login`);
  return `agrigate_session=${m[1]}`;
}

async function run(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passCount++; console.log(`✅ ${label}`); }
  catch (e) { failCount++; console.log(`❌ ${label} — ${(e as Error).message}`); }
}

async function main(): Promise<void> {
  // Login sessions for each role
  const platformSession = await getSession("platform@agri-gate.tn", "PlatformPass2026!");
  const techSession = await getSession("technician@agri-gate.tn", "TechPass2026!");
  const farmerSession = await getSession("farmer@agri-gate.tn", "FarmerPass2026!");

  // Get org/farm/user IDs from DB
  const ids = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM farms WHERE id = $1`, [farmId]
  );
  const orgId = ids.rows[0].org_id;

  // ── TEST 1: Edit user name ──
  await run("TEST 1: Edit user name via PATCH", async () => {
    // Get technician's userId
    const u = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'technician@agri-gate.tn'`
    );
    const userId = u.rows[0].id;

    const r = await api("PATCH", `/api/admin/users/${userId}`, { name: "Updated Tech Name" }, platformSession);
    assert(r.status === 200, `got ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.fullName === "Updated Tech Name", `name mismatch: ${r.json.fullName}`);

    // Verify persisted in DB
    const dbCheck = await pool.query<{ full_name: string }>(
      `SELECT full_name FROM users WHERE id = $1`, [userId]
    );
    assert(dbCheck.rows[0].full_name === "Updated Tech Name", "not persisted in DB");
  });

  // ── TEST 2: Duplicate email rejection ──
  await run("TEST 2: Duplicate email → clean 409, original preserved", async () => {
    // Get technician's userId
    const u = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'technician@agri-gate.tn'`
    );
    const userId = u.rows[0].id;

    // Try to set technician's email to farmer's email (duplicate)
    const r = await api("PATCH", `/api/admin/users/${userId}`, { email: "farmer@agri-gate.tn" }, platformSession);
    assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert(typeof r.json.error === "string" && !r.json.error.includes("duplicate key"), "raw DB error leaked");

    // Confirm email NOT changed
    const check = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`, [userId]
    );
    assert(check.rows[0].email === "technician@agri-gate.tn", "email was changed!");
  });

  // ── TEST 3: Reactivate deactivated user ──
  await run("TEST 3: Deactivate → blocked → reactivate → works", async () => {
    // Get technician userId
    const u = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'technician@agri-gate.tn'`
    );
    const userId = u.rows[0].id;

    // Deactivate
    const d = await api("PATCH", `/api/admin/users/${userId}`, { active: false }, platformSession);
    assert(d.status === 200 && d.json.isActive === false, `deactivate failed: ${JSON.stringify(d.json)}`);

    // Login blocked
    const blockedLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "technician@agri-gate.tn", password: "TechPass2026!" }),
    });
    if (blockedLogin.status !== 400) throw new Error(`deactivated login returned ${blockedLogin.status}`);

    // Reactivate
    const r = await api("PATCH", `/api/admin/users/${userId}`, { active: true }, platformSession);
    assert(r.status === 200 && r.json.isActive === true, `reactivate failed: ${JSON.stringify(r.json)}`);

    // Re-login must succeed
    const reLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "technician@agri-gate.tn", password: "TechPass2026!" }),
    });
    if (reLogin.status !== 200) throw new Error(`re-login after reactivate failed`);
  });

  // ── TEST 4: Delete user with ZERO history → hard ──
  await run("TEST 4: Zero-history user → hard delete", async () => {
    // Create fresh user
    const createRes = await api("POST", "/api/admin/users", {
      role: "farmer",
      orgId,
      farmId,
      fullName: "Zero History Test User",
      email: "zero-hist@test.local",
      temporaryPassword: "TestPass123!",
    }, platformSession);
    assert(createRes.status === 201, `create failed: ${createRes.status}`);
    const newUserId = createRes.json.id;

    // Hard-delete them
    const del = await api("DELETE", `/api/admin/users/${newUserId}`, undefined, platformSession);
    assert(del.status === 200, `delete failed: ${del.status}: ${JSON.stringify(del.json)}`);
    assert(del.json.mode === "hard", `expected mode:"hard", got ${del.json.mode}`);

    // Confirm gone from DB
    const check = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [newUserId]);
    assert((check.rowCount ?? 0) === 0, "user still exists in DB after hard delete");
  });

  // ── TEST 5: User WITH history → archived ──
  await run("TEST 5: User with ack history → archived, attribution preserved", async () => {
    // Acknowledge an alert as farmer (creates history)
    const alertsRes = await api("GET", `/api/farms/${farmId}/alerts?status=active`, undefined, farmerSession);
    const alerts: any[] = Array.isArray(alertsRes.json) ? alertsRes.json : [];
    if (!alerts.length) throw new Error("no active alerts to acknowledge");
    const alertToAck = alerts[0].id;

    // Ack as farmer
    const ackRes = await api("PATCH", `/api/alerts/${alertToAck}/acknowledge`, {}, farmerSession);
    assert(ackRes.status === 200, `ack failed: ${ackRes.status}`);

    // Now delete the farmer who has acknowledged_at history → archived mode
    const farmerUserId = (
      await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'farmer@agri-gate.tn'`)
    ).rows[0].id;

    const del = await api("DELETE", `/api/admin/users/${farmerUserId}`, undefined, platformSession);
    assert(del.status === 200, `delete failed: ${del.status}: ${JSON.stringify(del.json)}`);
    assert(del.json.mode === "archived", `expected archived, got ${del.json.mode}`);

    // Confirm is_active is false in DB
    const dbCheck = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`, [farmerUserId]
    );
    assert(dbCheck.rows[0].is_active === false, "is_active should be false after archive");

    // Historical attribution intact
    const ackCheck = await pool.query<{ acknowledged_by: string; acknowledged_at: string }>(
      `SELECT acknowledged_by, acknowledged_at::text AS acknowledged_at FROM alerts WHERE id = $1`,
      [alertToAck]
    );
    assert(ackCheck.rows[0].acknowledged_by === farmerUserId, "acknowledged_by lost after archive");
    assert(ackCheck.rows[0].acknowledged_at !== null, "acknowledged_at lost after archive");

    // Restore farmer
    await pool.query(`UPDATE users SET is_active = TRUE WHERE id = $1`, [farmerUserId]);
  });

  console.log(`\n${passCount} passed / ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main()
  .catch((e) => { console.error(e.message || e); process.exit(1); })
  .finally(() => { pool.end().catch(() => {}); });
