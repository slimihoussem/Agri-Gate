/**
 * Part 14 verification: attribution + deactivation flow.
 */
import * as dotenv from "dotenv";

dotenv.config();

import { pool } from "../src/db/pool";

const BASE = process.env.API_URL ?? "http://localhost:4000";
let cookie = "";

async function req(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function loginAs(email: string, password: string): Promise<void> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = r.headers.get("set-cookie") ?? "";
  cookie = (setCookie.match(/agrigate_session=[^;]+/)?.[0] ?? "") as string;
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status}`);
}

async function main(): Promise<void> {
  let pass = 0;
  let fail = 0;

  async function run(label: string, fn: () => Promise<string | void>): Promise<void> {
    try {
      const note = await fn();
      pass++;
      console.log(`✅ ${label}${note ? ` — ${note}` : ""}`);
    } catch (err) {
      fail++;
      console.log(`❌ ${label} — ${(err as Error).message}`);
    }
  }

  // Login all four roles
  await loginAs("admin@agri-gate.tn", "AdminPass2026!");
  const adminCookie = cookie;
  await loginAs("technician@agri-gate.tn", "TechPass2026!");
  const techCookie = cookie;
  await loginAs("farmer@agri-gate.tn", "FarmerPass2026!");
  const farmerCookie = cookie;
  await loginAs("platform@agri-gate.tn", "PlatformPass2026!");
  const platformCookie = cookie;

  const farmId = "9cb3551b-8b18-428b-bff0-393778658f61";

  // ── capability matrix ──

  await run("farmer PATCH thresholds → 200 (capability)", async () => {
    cookie = farmerCookie;
    const r = await req("PATCH", `/api/farms/${farmId}/settings`, { moistureLow: 25 });
    if (r.status !== 200) throw new Error(`got ${r.status}`);
  });

  await run("farmer POST zone → 403 (no zones.edit)", async () => {
    cookie = farmerCookie;
    const r = await req("POST", `/api/farms/${farmId}/zones`, {
      name: "X", cropType: "Olive", targetMoisture: 45,
    });
    if (r.status !== 403) throw new Error(`got ${r.status}`);
  });

  await run("farmer POST node → 403 (no nodes.edit)", async () => {
    cookie = farmerCookie;
    const r = await req("POST", "/api/nodes", { name: "X", farmId });
    if (r.status !== 403) throw new Error(`got ${r.status}`);
  });

  await run("technician PATCH zone → 200", async () => {
    cookie = techCookie;
    const zones = (await req("GET", `/api/farms/${farmId}/zones`)).json;
    const r = await req("PATCH", `/api/zones/${zones[0].id}`, { targetMoisture: 45 });
    if (r.status !== 200) throw new Error(`got ${r.status}`);
  });

  await run("technician farm identity → 403 (no farmIdentity.edit)", async () => {
    cookie = techCookie;
    const r = await req("PATCH", `/api/farms/${farmId}`, { name: "X" });
    if (r.status !== 403) throw new Error(`got ${r.status}`);
  });

  await run("admin user mgmt → technician 403 on /api/admin/users", async () => {
    cookie = techCookie;
    const r = await req("GET", "/api/admin/users");
    if (r.status !== 403) throw new Error(`got ${r.status}`);
  });

  // Restore technician session for remaining tests
  await loginAs("technician@agri-gate.tn", "TechPass2026!");

  console.log(`\n${pass} passed / ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
