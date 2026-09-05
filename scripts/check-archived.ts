/**
 * One-off verification: includeInactive behavior for farm nodes.
 */
import * as dotenv from "dotenv";

dotenv.config();

const BASE = process.env.API_URL ?? "http://localhost:4000";
const FARM = "9cb3551b-8b18-428b-bff0-393778658f61";

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "technician@agri-gate.tn", password: "TechPass2026!" }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").match(/agrigate_session=[^;]+/)?.[0] ?? "";

  const get = async (url: string): Promise<any[]> => {
    const res = await fetch(`${BASE}${url}`, { headers: { cookie } });
    return (await res.json()) as any[];
  };

  const def = await get(`/api/farms/${FARM}/nodes`);
  const all = await get(`/api/farms/${FARM}/nodes?includeInactive=true`);

  console.log(`default list        : ${def.length} nodes`);
  console.log(`includeInactive=true: ${all.length} nodes`);
  const rg02all = all.find((n) => n.id === "SN-RG-02");
  const rg02def = def.find((n) => n.id === "SN-RG-02");
  console.log(`archived SN-RG-02   : in-default=${rg02def !== undefined} in-withInactive=${rg02all !== undefined} (active=${rg02all?.active})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
