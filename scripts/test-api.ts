/**
 * AgriGate API smoke tests — hits EVERY endpoint of the Part 3 REST API
 * against a running server and validates response shapes against the spec.
 *
 * Prerequisites:
 *   1. TimescaleDB container up + migrated + seeded   (docker compose up -d && npm run db:reset)
 *   2. API server running                              (npm run server:dev)
 *
 * Usage: npm run api:test          (override target with API_URL env var)
 */
import * as dotenv from "dotenv";

dotenv.config();

import { pool } from "../src/db/pool";

const BASE_URL = process.env.API_URL ?? "http://localhost:4000";
const TEST_NODE_ID = "SN-API-TEST-01"; // fixed id so re-runs stay idempotent

type JsonResponse = { status: number; json: any };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<JsonResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(COOKIE ? { cookie: COOKIE } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Part 10: session cookie captured at login, sent on every request below. */
let COOKIE = "";

async function loginAs(email: string, password: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/agrigate_session=([^;]+)/);
  if (!match) throw new Error("no session cookie in login response");
  COOKIE = `agrigate_session=${match[1]}`;
}

let passCount = 0;
let failCount = 0;

async function run(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passCount++;
    console.log(`  ✅ ${label}`);
  } catch (err) {
    failCount++;
    console.log(`  ❌ ${label}`);
    console.log(`     ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log(`\n🧪 AgriGate API smoke tests → ${BASE_URL}\n`);

  let farmId = "";
  let zoneAId = "";
  let scheduleZoneCId = "";
  let activeAlertId = "";
  let userId = "";

  // ── Health ────────────────────────────────────────────────────────────────
  await run("GET /api/health (public)", async () => {
    const { status, json } = await req("GET", "/api/health");
    assert(status === 200, `expected 200, got ${status}`);
    assert(json?.status === "ok", `unexpected payload ${JSON.stringify(json)}`);
  });

  // ── Auth gate (Part 10) ───────────────────────────────────────────────────
  await run("401 on /api/farms without session", async () => {
    const saved = COOKIE;
    COOKIE = "";
    const { status } = await req("GET", "/api/farms");
    COOKIE = saved;
    assert(status === 401, `expected 401, got ${status}`);
  });

  await run("login technician → RBAC session", async () => {
    await loginAs("technician@agri-gate.tn", "TechPass2026!");
  });

  // ── Farms ─────────────────────────────────────────────────────────────────
  await run("GET /api/farms", async () => {
    const { status, json } = await req("GET", "/api/farms");
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json) && json.length >= 1, "expected a non-empty farms array");
    assert(typeof json[0].id === "string" && typeof json[0].name === "string", "farm shape mismatch");
    farmId = json[0].id;
  });

  await run("GET /api/farms/:farmId/dashboard", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/dashboard`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(json?.farm?.id === farmId, "dashboard.farm.id mismatch");
    const stats = json?.stats;
    assert(stats && "avgMoisture" in stats && "activeNodes" in stats &&
           "totalNodes" in stats && "waterUsedTodayL" in stats && "openAlerts" in stats,
           `stats keys missing: ${JSON.stringify(stats)}`);
    assert(Array.isArray(json.zones) && json.zones.length === 3, "expected 3 zones in dashboard");
  });

  await run("404 on unknown farm", async () => {
    const { status, json } = await req(
      "GET",
      `/api/farms/00000000-0000-0000-0000-000000000000/dashboard`
    );
    assert(status === 404, `expected 404, got ${status}`);
    assert(typeof json?.error === "string", `expected { error } body, got ${JSON.stringify(json)}`);
  });

  await run("400 on malformed farmId", async () => {
    const { status, json } = await req("GET", `/api/farms/not-a-uuid/zones`);
    assert(status === 400, `expected 400, got ${status}`);
    assert(typeof json?.error === "string", `expected { error } body, got ${JSON.stringify(json)}`);
  });

  // ── Zones ─────────────────────────────────────────────────────────────────
  await run("GET /api/farms/:farmId/zones (+ null contract)", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/zones`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json) && json.length === 3, "expected 3 zones");

    for (const zone of json) {
      assert(zone.status === "ok" || zone.status === "warning" ||
             zone.status === "critical" || zone.status === "disconnected",
             `invalid status "${zone.status}"`);
      assert(zone.activeNodeCount >= 0, "activeNodeCount must be >= 0");
      if (zone.status === "disconnected") {
        assert(zone.moisture === null && zone.nitrogen === null &&
               zone.phosphorus === null && zone.potassium === null,
               `${zone.name}: disconnected zone must have null moisture/N/P/K`);
        assert(zone.activeNodeCount === 0, `${zone.name}: disconnected implies 0 active nodes`);
      }
      assert(zone.lastWatered === null || !Number.isNaN(Date.parse(zone.lastWatered)),
             "lastWatered must be ISO timestamp or null");
    }

    zoneAId = json.find((z: any) => z.name.includes("Zone A"))?.id;
    assert(zoneAId, "Zone A not found");

    // Informational: whether Terraced Basin is currently disconnected depends
    // on its node's live state (the simulator revives flagged-offline nodes),
    // so we report rather than hard-assert.
    const zoneC = json.find((z: any) => z.name.includes("Terraced Basin"));
    console.log(`     statuses: ${json.map((z: any) => `"${z.name}"→${z.status}`).join(", ")}`);
    if (zoneC?.status !== "disconnected") {
      console.log(`     ℹ Zone C currently "${zoneC?.status}" (its actuator node has reported recently)`);
    }
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────
  await run("GET /api/farms/:farmId/nodes", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/nodes`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json) && json.length >= 6, `expected >=6 seeded nodes, got ${json?.length}`);
    for (const node of json) {
      assert(node.commMethod === "wifi", "commMethod must be wifi");
      assert(node.battery === null || (node.battery >= 0 && node.battery <= 100), "battery out of range");
      assert(node.x === null || (node.x >= 0 && node.x <= 100), "x out of range");
      if (typeof node.isActuator === "boolean") {
        // Part 9 field present — at least one actuator per farm expected.
      }
    }
  });

  await run("GET /api/nodes/:nodeId", async () => {
    const { status, json } = await req("GET", "/api/nodes/SN-RG-01");
    assert(status === 200, `expected 200, got ${status}`);
    assert(json?.id === "SN-RG-01", "node id mismatch");
    assert(typeof json.zoneName === "string", "zoneName join missing");
  });

  await run("GET /api/nodes/:nodeId → 404 unknown", async () => {
    const { status } = await req("GET", "/api/nodes/SN-DOES-NOT-EXIST");
    assert(status === 404, `expected 404, got ${status}`);
  });

  await run("POST /api/nodes (create, idempotent re-run)", async () => {
    const created = await req("POST", "/api/nodes", {
      id: TEST_NODE_ID,
      farmId,
      zoneId: zoneAId,
      name: "API Smoke Test Node",
      commMethod: "wifi",
      mapX: 50,
      mapY: 50,
    });
    assert(created.status === 201 || created.status === 409,
           `expected 201 (created) or 409 (already exists from prior run), got ${created.status}: ${JSON.stringify(created.json)}`);

    const fetched = await req("GET", `/api/nodes/${TEST_NODE_ID}`);
    assert(fetched.status === 200, `created node not retrievable (${fetched.status})`);
    assert(fetched.json.zoneName?.includes("Zone A"), "new node zone join wrong");
    // Freshly registered node has no telemetry yet → explicit nulls, never fake zeros
    assert(fetched.json.lastSeen === null, "fresh node lastSeen must be null");
  });

  await run("POST /api/nodes → 400 validation (missing name)", async () => {
    const { status, json } = await req("POST", "/api/nodes", { farmId });
    assert(status === 400, `expected 400, got ${status}`);
    assert(Array.isArray(json?.details), "expected details[] on validation error");
  });

  // ── Telemetry trend ───────────────────────────────────────────────────────
  await run("GET /api/farms/:farmId/telemetry/trend?hours=24 (generic zone keys)", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/telemetry/trend?hours=24`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json?.zones) && json.zones.length === 3, "expected zones[] with 3 entries");
    let totalPoints = 0;
    for (const zt of json.zones) {
      assert(typeof zt.zoneId === "string" && /^[0-9a-f-]{36}$/i.test(zt.zoneId),
             "zoneId must be a UUID — hardcoded zone keys are forbidden");
      assert(typeof zt.zoneName === "string", "zoneName required");
      assert(Array.isArray(zt.points), "points must be an array");
      for (const p of zt.points) {
        assert(!Number.isNaN(Date.parse(p.time)), "point.time must be ISO");
        assert(typeof p.avgMoisture === "number", "point.avgMoisture must be number");
      }
      totalPoints += zt.points.length;
    }
    assert(totalPoints > 0, "expected at least some trend points after seeding");
    console.log(`     zones: [${json.zones.map((z: any) => `${z.zoneName}: ${z.points.length}pts`).join(", ")}]`);
  });

  // ── Alerts ────────────────────────────────────────────────────────────────
  await run("GET /api/farms/:farmId/alerts (all)", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/alerts`);
    assert(status === 200, `expected 200, got ${status}`);
    // Seed creates 7; the Part 8 engine legitimately adds more over time.
    assert(Array.isArray(json) && json.length >= 7, `expected >=7 alerts, got ${json?.length}`);
    for (const a of json) {
      assert(["info", "warning", "critical"].includes(a.severity), `bad severity ${a.severity}`);
      assert(a.acknowledged === (a.acknowledgedAt !== null), "acknowledged flag must match timestamp");
    }
  });

  await run("GET alerts?status=active / acknowledged filters", async () => {
    const active = await req("GET", `/api/farms/${farmId}/alerts?status=active`);
    const acked = await req("GET", `/api/farms/${farmId}/alerts?status=acknowledged`);
    assert(active.status === 200 && acked.status === 200, "filters returned non-200");
    assert(active.json.every((a: any) => !a.acknowledged), "active filter leaked acknowledged rows");
    assert(acked.json.every((a: any) => a.acknowledged), "acknowledged filter leaked active rows");
    // NOTE: no strict sum equality — the simulator can generate new alerts
    // between the two snapshots; individual filter correctness is what matters.
    if (active.json.length > 0) {
      activeAlertId = [...active.json].sort((a: any, b: any) =>
        b.triggeredAt.localeCompare(a.triggeredAt))[0].id;
    }
  });

  await run("PATCH /api/alerts/:alertId/acknowledge (session user attributed)", async () => {
    if (!activeAlertId) {
      console.log("     ⚠ no active alert available — ack attribution check skipped");
      return;
    }

    const { status, json } = await req("PATCH", `/api/alerts/${activeAlertId}/acknowledge`);
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(json.acknowledged === true && json.acknowledgedAt !== null, "ack state not persisted");

    // Part 10: acknowledged_by must be a REAL users.id from the session.
    const dbRow = await pool.query<{ acknowledged_by: string | null }>(
      `SELECT acknowledged_by FROM alerts WHERE id = $1`,
      [activeAlertId]
    );
    assert(
      dbRow.rows[0].acknowledged_by !== null,
      "acknowledged_by is NULL — session attribution missing"
    );

    const active = await req("GET", `/api/farms/${farmId}/alerts?status=active`);
    assert(!active.json.some((a: any) => a.id === activeAlertId), "acked alert still listed as active");
  });

  // NOTE: RBAC farmer-403 test lives in the irrigation section below (needs a
  // schedule id) and restores the technician session when done.

  // ── Irrigation ────────────────────────────────────────────────────────────
  await run("GET /api/farms/:farmId/irrigation/schedules", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/irrigation/schedules`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json) && json.length === 3, `expected 3 schedules, got ${json?.length}`);
    for (const s of json) {
      assert(/^\d{2}:\d{2}:\d{2}$/.test(s.startTime), `startTime format wrong: ${s.startTime}`);
      assert(s.repeatDays.every((d: number) => Number.isInteger(d) && d >= 0 && d <= 6),
             "repeatDays must be integers 0..6");
      assert(typeof s.durationMinutes === "number" && s.durationMinutes > 0, "duration invalid");
    }
    const zoneCSchedule = json.find((s: any) => s.zoneName.includes("Terraced Basin"));
    assert(zoneCSchedule && zoneCSchedule.active === false, "Zone C schedule should be inactive per seed");
    scheduleZoneCId = zoneCSchedule.id;
  });

  await run("PATCH /api/irrigation/schedules/:id (toggle + revert)", async () => {
    const on = await req("PATCH", `/api/irrigation/schedules/${scheduleZoneCId}`, { active: true });
    assert(on.status === 200 && on.json.active === true, `enable failed: ${on.status} ${JSON.stringify(on.json)}`);
    assert(/^\d{2}:\d{2}:\d{2}$/.test(on.json.startTime), "startTime must survive update round-trip");

    const off = await req("PATCH", `/api/irrigation/schedules/${scheduleZoneCId}`, { active: false });
    assert(off.status === 200 && off.json.active === false, "revert failed");
  });

  await run("PATCH schedule → 400 empty patch", async () => {
    const { status } = await req("PATCH", `/api/irrigation/schedules/${scheduleZoneCId}`, {});
    assert(status === 400, `expected 400 for empty patch, got ${status}`);
  });

  await run("RBAC: farmer cannot PATCH schedules (403, backend-enforced)", async () => {
    await loginAs("farmer@agri-gate.tn", "FarmerPass2026!");
    try {
      const { status, json } = await req("PATCH", `/api/irrigation/schedules/${scheduleZoneCId}`, {
        active: true,
      });
      assert(status === 403, `expected 403 for farmer schedule edit, got ${status}`);
      assert(typeof json?.error === "string", "expected { error } body");
    } finally {
      await loginAs("technician@agri-gate.tn", "TechPass2026!"); // always restore session
    }
  });

  // ── Part 10 ext: platform admin & tenant isolation ────────────────────────
  let secondOrgFarmId = "";
  let orgAId = "";

  await run("tenant fixture: second client org+farm (idempotent)", async () => {
    await pool.query(`DELETE FROM farms WHERE name = 'Oued El Ma Test Farm'`);
    await pool.query(`DELETE FROM organizations WHERE name = 'Second Client Org (test)'`);
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name) VALUES ('Second Client Org (test)') RETURNING id`
    );
    const farm = await pool.query<{ id: string }>(
      `INSERT INTO farms (org_id, name, location) VALUES ($1, 'Oued El Ma Test Farm', 'Kasserine (test)') RETURNING id`,
      [org.rows[0].id]
    );
    secondOrgFarmId = farm.rows[0].id;
    const orgA = await pool.query<{ org_id: string }>(`SELECT org_id FROM farms WHERE id = $1`, [farmId]);
    orgAId = orgA.rows[0].org_id;
  });

  await run("platform admin: unscoped farms list rejected (explicit pick rule)", async () => {
    await loginAs("platform@agri-gate.tn", "PlatformPass2026!");
    const { status, json } = await req("GET", `/api/farms`);
    assert(status === 400, `expected 400 without ?orgId, got ${status}`);
    assert(/explicit/i.test(json?.error ?? ""), "error should demand an explicit orgId");
  });

  await run("platform admin: explicit ?orgId returns that client only", async () => {
    const { status, json } = await req("GET", `/api/farms?orgId=${orgAId}`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json) && json.some((f: any) => f.id === farmId), "expected org A farm in scoped list");
    assert(json.every((f: any) => f.id === farmId), "list leaked farms outside the requested org");
  });

  await run("client user blocked from another org's farm (403)", async () => {
    await loginAs("farmer@agri-gate.tn", "FarmerPass2026!");
    const { status, json } = await req("GET", `/api/farms/${secondOrgFarmId}/zones`);
    assert(status === 403, `expected 403 cross-tenant, got ${status}`);
    assert(/different organization/.test(json?.error ?? ""), "unexpected 403 message");
  });

  await run("platform admin reads any explicitly named farm", async () => {
    await loginAs("platform@agri-gate.tn", "PlatformPass2026!");
    const { status, json } = await req("GET", `/api/farms/${secondOrgFarmId}/zones`);
    assert(status === 200 && Array.isArray(json), `expected 200 zones array, got ${status}`);
    await loginAs("technician@agri-gate.tn", "TechPass2026!"); // restore session
  });

  await run("requirePlatformAdmin: staff-only user directory", async () => {
    await loginAs("farmer@agri-gate.tn", "FarmerPass2026!");
    const denied = await req("GET", `/api/admin/users`);
    assert(denied.status === 403, `farmer should get 403, got ${denied.status}`);

    await loginAs("platform@agri-gate.tn", "PlatformPass2026!");
    const allowed = await req("GET", `/api/admin/users`);
    assert(allowed.status === 200, `platform admin should get 200, got ${allowed.status}`);
    assert(Array.isArray(allowed.json) && allowed.json.length >= 4, "expected >=4 seeded users");

    await loginAs("technician@agri-gate.tn", "TechPass2026!"); // restore session
  });

  await run("POST /api/irrigation/schedules/:id/start (stub, manual log)", async () => {
    const { status, json } = await req("POST", `/api/irrigation/schedules/${scheduleZoneCId}/start`);
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(json)}`);
    // Part 10: triggered_by is the authenticated operator's id (uuid).
    assert(
      typeof json.triggeredBy === "string" &&
        /^[0-9a-f-]{36}$/i.test(json.triggeredBy),
      `triggeredBy must be the session user id, got ${json?.triggeredBy}`
    );
    assert(json.commandDelivered === true, "MQTT start command should be delivered (broker running)");
    assert(json.skipped === false, "manual start must not be skipped");
    assert(!Number.isNaN(Date.parse(json.startedAt)) && !Number.isNaN(Date.parse(json.endedAt)),
           "startedAt/endedAt must be ISO timestamps");
  });

  await run("GET /api/farms/:farmId/irrigation/logs (skip reasons inline)", async () => {
    const { status, json } = await req("GET", `/api/farms/${farmId}/irrigation/logs`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(json) && json.length >= 6, `expected >=6 logs (5 seeded + 1 manual), got ${json?.length}`);

    const skipped = json.filter((l: any) => l.skipped);
    assert(skipped.length >= 2, "seed contains 2 skipped entries");
    for (const l of skipped) {
      assert(typeof l.skipReason === "string" && l.skipReason.length > 0,
             "skipped row must carry an inline, visible skipReason");
    }
    assert(
      /^[0-9a-f-]{36}$/i.test(json[0].triggeredBy),
      "newest log should be the manual start attributed to the session user"
    );
    assert(typeof json[0].waterUsedL === "number", "waterUsedL must be numeric");
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────");
  console.log(`✅ ${passCount} passed   ❌ ${failCount} failed`);
  console.log("──────────────────────────────\n");
}

main()
  .catch((err) => {
    console.error("💥 Test runner crashed:", err);
    failCount++;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    process.exit(failCount > 0 ? 1 : 0);
  });
