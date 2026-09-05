# AgriGate — REST API (Part 3)

Backend REST API for the AgriGate precision-agriculture platform (pilot olive farm in Rgueb, Sidi Bouzid, Tunisia).

- **Stack:** Node.js + TypeScript + Express, zod validation, raw SQL via `pg` (shared pool), no ORM
- **Database:** connects to the Part 2 TimescaleDB instance through `DATABASE_URL` (`.env`)
- **Out of scope (by design):** MQTT telemetry ingestion (Part 4) and authentication (Part 10)

---

## Quick Start

```bash
# 1. Start TimescaleDB + migrate + seed  (see db/README.md for details)
docker compose up -d
npm run migrate:up
npm run seed            # or npm run db:reset to wipe + re-run everything

# 2. Start the API (dev, auto-reload on file changes)
npm run server:dev      # → http://localhost:4000
```

### Stable Seed Identities (idempotent `db:reset`)

`db:reset` is fully idempotent for the core test accounts — the same UUIDs are recreated every run. This means:
- **JWT tokens survive resets** (same `userId` in the token)
- **Farm context / sessionStorage survives resets** (same `farmId`/`orgId`)
- **Developer workflow:** log in once, keep working after `db:reset`

Only these named entities are stable. Any ad-hoc farms/nodes/users created manually during a session are correctly wiped on reset.

| Entity | Stable UUID | Notes |
|---|---|---|
| **Organizations** | | |
| AgriGate Pilot Org | `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` | |
| Second Client Org (test) | `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb` | |
| Kairouan Cooperative (test) | `cccccccc-cccc-cccc-cccc-cccccccccccc` | |
| Sfax Cooperative (test) | `dddddddd-dddd-dddd-dddd-dddddddddddd` | |
| **Users** | | |
| platform@agri-gate.tn | `11111111-1111-1111-1111-111111111111` | Platform admin (org_id=NULL) |
| admin@agri-gate.tn | `22222222-2222-2222-2222-222222222222` | Farm admin (org_id=NULL) |
| technician@agri-gate.tn | `33333333-3333-3333-3333-333333333333` | Technician (org_id=NULL) |
| farmer@agri-gate.tn | `44444444-4444-4444-4444-444444444444` | Farmer (org_id=ORG_PILOT, farm_id=Rgueb Pilot Farm) |
| **Farm** | | |
| Rgueb Pilot Farm | `55555555-5555-5555-5555-555555555555` | org_id=ORG_PILOT |
| **Zones** | | |
| Zone A • North Grove | `66666666-6666-6666-6666-666666666666` | farm_id=FARM_PILOT |
| Zone B • South Slope | `77777777-7777-7777-7777-777777777777` | farm_id=FARM_PILOT |
| Zone C • Terraced Basin | `88888888-8888-8888-8888-888888888888` | farm_id=FARM_PILOT |
| **Nodes** (string IDs) | | |
| SN-RG-01 .. SN-RG-06 | Hardcoded string IDs | String PKs, not UUIDs |

*Defined in `scripts/seed.ts` — search `SEED_IDS`.*

Health check:

```bash
curl http://localhost:4000/api/health
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://agrigat_user:...@localhost:5432/agrigat_db` | Part 2 connection string (reused as-is) |
| `API_PORT` | `4000` | API listen port (`API_PORT` is used instead of `PORT` so it never clashes with `next dev`) |

CORS is enabled for all origins in dev — the Next.js frontend runs on port 3000.

### Testing every endpoint

With the server running and DB seeded:

```bash
npm run api:test
```

Runs ~20 assertions across all 13 endpoints, including the required checks:
Zone C ("Terraced Basin") returns `status: "disconnected"` with null moisture/N/P/K,
and the trend endpoint returns generic zone-keyed data (no hardcoded zoneA/B/C).

---

## Architecture

Strict layer separation — HTTP layer contains **no SQL and no business logic**;
services contain **no express types**.

```text
src/
├── server.ts                 # app setup, middleware order, route mounting
├── db/
│   └── pool.ts               # shared pg Pool (from Part 2)
├── schemas/                  # zod schemas, defined before handlers use them
│   ├── zone.schema.ts        #   zones + farmId param + computed ZoneSummary contract
│   ├── node.schema.ts        #   node DTOs + create-node body
│   ├── alert.schema.ts       #   alerts + acknowledge body + status filter query
│   ├── irrigation.schema.ts  #   schedules/logs + update body
│   └── telemetry.schema.ts   #   trend query (?hours=) + trend point shapes
├── services/                 # ALL business logic + SQL (no express imports)
│   ├── farmService.ts        #   farm list + dashboard aggregation
│   ├── zoneService.ts        #   zone aggregates + ⚠ single source of truth for status thresholds
│   ├── nodeService.ts        #   node CRUD-ish reads + registration
│   ├── telemetryService.ts   #   hourly moisture trend (generic per-zone)
│   ├── alertService.ts       #   list/filter + acknowledge
│   └── irrigationService.ts  #   schedules, manual start stub, logs
├── routes/                   # HTTP layer only: validate → call service → return
│   ├── farms.routes.ts       #   also hosts zones/nodes/trend/alerts/schedules/logs sub-paths
│   ├── nodes.routes.ts       #   /api/nodes
│   ├── alerts.routes.ts      #   /api/alerts
│   └── irrigation.routes.ts  #   /api/irrigation
└── middleware/
    ├── errorHandler.ts       # central handler → { error } JSON with correct status
    └── validateRequest.ts    # zod validation of body/query/params → 400 + details[]
```

**Response format:** success returns data directly (200/201); errors return `{ "error": "message" }` with 400/404/409/500. Validation failures additionally carry `details[]`.

---

## Business Rules

### Zone status — single source of truth (`zoneService.computeZoneStatus`)

Computed server-side from latest-per-active-node averaged moisture vs. zone target.
The frontend renders whatever arrives; thresholds are duplicated nowhere else:

| Condition | Status |
|---|---|
| no active nodes (or no readings) → moisture is `null`, N/P/K all `null` | `"disconnected"` |
| moisture < target − 20 | `"critical"` |
| moisture < target − 10 | `"warning"` |
| else | `"ok"` |

A dead sensor is never conflated with dry soil. "Active" = node status ≠ `offline`.
`lastWatered` = `MAX(started_at)` of non-skipped irrigation logs, returned as a **raw ISO timestamp** ("2h ago" formatting is a frontend concern).

Node DTOs (`/api/farms/:farmId/nodes`, `/api/nodes/:nodeId`, `/api/zones/:zoneId/nodes`) embed the **latest telemetry reading** via a `LATERAL` join: `moisture`, `soilTemp`, `ambientTemp`, `humidity` (all nullable) — node cards render live soil values with no extra fetch.

### Telemetry trend

Reads the `telemetry_hourly` continuous aggregate, grouped generically by zone id/name — works for any number of zones. The aggregate's refresh policy lags up to ~1 h behind real time (`end_offset => INTERVAL '1 hour'`), so the newest bucket can be slightly stale by design.

### Manual irrigation start — OPEN-ENDED (Part 9, no cutoff)

`POST /api/nodes/:nodeId/irrigation/start` is the per-node manual Open. The body is **empty by design**: no duration is requested and none is sent to the valve, so the run is **open-ended** — it stays open until the operator issues `POST /api/nodes/:nodeId/irrigation/stop`. There is **no max-runtime safety cutoff anywhere** on the manual control path; the device never force-closes an open run.

Instead of force-closing, the 2-minute periodic sweep (in the ingest process) compares each open run's elapsed time to the node's effective `irrigationMaxRunningMinutes` threshold (default 240; defaults < farm < node override) and files a **`irrigation_long_running`** warning ("check for a stuck valve or forgotten shutoff"). Like every alert it dedupes per open unacknowledged occurrence, is never auto-resolved, and never alters valve state. Scheduled recurring/one-time irrigation still carries its own explicit duration and the device self-closes at the end of it.

### Alert acknowledgement

Sets `acknowledged_at = NOW()` + `acknowledged_by = userId` (client-supplied until Part 10 wires real auth). `acknowledged_at IS NULL` is the single source of truth for "active".

### Last-active-actuator safety rule (a zone must always keep a valve)

A **populated** zone (≥1 node assigned) must always retain at least one **active actuator** node so water can be controlled from the platform. Every code path that would drop a populated zone's active-actuator count to zero is rejected with **`400`**:

```
This is the last active valve in {zone} — at least one actuator is required per
zone to maintain water control. Assign another node as an actuator first.
```

The rule is enforced in `src/services/nodeService.ts` via the shared helper `wouldLeaveZoneWithoutActuator(zoneId, { excludingNodeId, newIsActuatorValue })`:

| Action | Endpoint | Blocked? |
|---|---|---|
| Disable actuator mode (`isActuator → false`) on the last active valve | `PATCH /api/nodes/:nodeId` | ✅ 400 |
| Move an ACTIVE actuator to a **different** zone (leaves its source zone) | `PATCH /api/nodes/:nodeId` | ✅ 400 |
| Deactivate (`active → false`) an ACTIVE actuator | `PATCH /api/nodes/:nodeId` | ✅ 400 |
| Delete an ACTIVE actuator (archive **or** hard-delete) | `DELETE /api/nodes/:nodeId` | ✅ 400 |
| Same actions on a **sensor** (non-actuator), or on an **inactive** actuator | above | ✅ allowed |
| Same actions once a **2nd** active actuator exists in the zone | above | ✅ allowed |

Notes:

- Only the **last** active actuator is protected; adding a second valve immediately unblocks further changes to the first.
- The check runs **before** the archive-vs-hard-delete decision on delete, and before/independent of the pre-existing active-irrigation-schedule guard on `is_actuator → false`.
- Zone DTOs (`GET /api/farms/:farmId/zones`) now expose `nodeCount` (total nodes) and `activeActuatorCount`; the UI shows a **"No valve control"** warning badge on a zone when `nodeCount > 0` but `activeActuatorCount === 0` (Dashboard zone cards, Irrigation zone list, Settings zones panel).

### Last-running-valve rule (you can't silently cut a zone's only water)

Closing the **last currently-running valve in a zone** is blocked for everyone unless a technician/admin explicitly forces it — so the sole active irrigation event in a zone can never be killed by accident or by a stray click.

`POST /api/nodes/:nodeId/irrigation/stop` rejects a plain stop with a **distinct** response when the node is running and no **other** `irrigation_logs` row for the same zone is open (`ended_at IS NULL AND skipped = false AND node_id != :nodeId`):

```
HTTP/1.1 409 Conflict
{ "blocked": true, "reason": "last_running_valve_in_zone", "zoneName": "Zone A • North Grove" }
```

- **Farmer (any role without the force override)**: receives `409` + the dialog "This is the only valve currently running in {zone}." with only a Cancel action and a "Contact a technician…" note. Sending `{ force: true }` directly is still rejected with `403 { blocked: true, reason: "force_close_forbidden" }` — the backend, not the UI, is the real enforcement point.
- **Technician / Admin**: the dialog shows an extra **Force Close** action (a real second `POST` with `{ "force": true }`). The backend requires `role === "technician" || role === "admin"` and otherwise proceeds exactly as a normal stop.
- **Audit**: any force that actually bypassed the rule writes a `staff_actions_log` row with `action = 'force_close_last_valve'` (nodeId, zoneName, real staff user id, `created_at`).

| Scenario | Result |
|---|---|
| Close the only running valve in a zone (farm) | ✅ 409 `last_running_valve_in_zone` |
| Farmer sends `force: true` directly | ✅ 403 `force_close_forbidden` (no override) |
| Technician/Admin force-close | ✅ 200 + `force_close_last_valve` audit row |
| Two valves running in the **same zone**, close one | ✅ allowed (no block) |
| A valve running in a **different zone** | ✅ no effect (guard is per-zone) |

The guard lives in `src/services/irrigationService.ts` (`checkLastRunningValveBlock`) and is enforced in `src/routes/nodes.routes.ts`.

### Zone valves — a dedicated main valve per zone (Part 19)

A **zone valve** is ONE dedicated main-valve node per zone, independent infra
from the regular field-node actuators that run schedules. The app treats it
as a separate thing: schemas/card-level control are the same, but it has no
sensor data, is unique per zone, and is protected by a **farm-wide** safety
rule (a farm must always keep at least one zone valve open).

**Data model** (`migrations/1700000019000_zone_valves.js` + `…2000`):

- `ALTER TABLE nodes ADD COLUMN is_zone_valve BOOLEAN NOT NULL DEFAULT false`.
- Sole DB constraint: `CREATE UNIQUE INDEX idx_one_zone_valve_per_zone ON nodes
  (zone_id) WHERE is_zone_valve = true AND active = true` — at most **one
  ACTIVE** valve per zone. Deletion is soft (`active=false`), so deleting a
  valve frees the slot for a new one.

**Creation** (`POST /api/nodes`). Send `isZoneValve: true` (plus the same
infra fields: `mqttClientId`, `flowRateLPerMin`, `maxRuntimeMinutes`). The
service forces `is_actuator = true` and `sensor_capabilities = []` regardless
of input, requires a `zoneId`, pre-checks the zone for an existing active
valve (friendly **409**, race-collision converted from the unique index), and
holds the same `mqtt_client_id` uniqueness rule as other nodes.

| Input | Result |
|---|---|
| `isZoneValve: true` with a `zoneId` | ✅ created as actuator, zero sensor caps |
| A second `isZoneValve: true` for the same **active** zone | ✅ 409 "already has a main valve — remove it first" |
| `isZoneValve: true` without `zoneId` | ✅ 400 |
| Delete the zone valve (replaces it later) | ✅ slot freed (index is `active = true`-filtered) |

**Stop safety rule** (farm-wide, in `src/routes/nodes.routes.ts`): when the
node `is_zone_valve`, `checkFarmZoneValveBlock` counts OTHER farm-wide open
zone valves. Closing the last open one (i.e. a farm that would end with zero
open zone valves) is blocked:

```
HTTP/1.1 409 Conflict
{ "blocked": true, "reason": "last_open_zone_valve_in_farm" }
```

- **Farmer** (no force override): 409 only + the "This is the only zone valve
  currently open on the farm." dialog. `force: true` → 403
  `force_close_forbidden`.
- **Technician / Admin**: 409 dialog with a **Force Close** action → 200 +
  `staff_actions_log` row `action = 'force_close_last_zone_valve'` (nodeId,
  reason).
- Zone valves run this farm-wide rule **instead of** the per-zone
  `last_running_valve_in_zone` rule; the per-zone rule remains and its
  `other_running` count excludes zone valves, so field-node and zone-valve
  water paths are fully independent (opening/closing one never affects the
  other family).

| Scenario | Result |
|---|---|
| Create zone valve on Zone A → card at top of the zone page, no telemetry | ✅ |
| Second zone valve on Zone A | ✅ 409 |
| Open zone valve A (Zone A) + field valve, independently | ✅ both open |
| Close zone valve A while zone valve B (different zone) is open | ✅ allowed |
| Close the LAST open zone valve farm-wide | ✅ 409 `last_open_zone_valve_in_farm` |
| Farmer force-closes it (`force: true`) | ✅ 403 `force_close_forbidden` |
| Technician/Admin force-closes it | ✅ 200 + `force_close_last_zone_valve` audit row |
| Close the only running **field-node** valve in a zone | ✅ 409 `last_running_valve_in_zone` (unchanged) |

**Zone DTOs** (`GET /api/farms/:farmId/zones`) gain `hasZoneValve` +
`zoneValveRunning` (open run on the valve itself). The Irrigation zone list
shows a droplet indicator per zone (filled olive = valve open, outlined =
closed), and `/irrigation/[zoneId]` renders the valve as a distinct card above
the field-node grid with an **Add Zone Valve** empty-state (technician/admin
only, simplified form: name, mqtt client id, flow rate, max runtime — no
sensor picker).

---

## Endpoints

Base URL: `http://localhost:4000`

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/api/farms` | List farms |
| 2 | GET | `/api/farms/:farmId/dashboard` | Hero stats (avg moisture, active nodes, water today L, open alerts) + zones |
| 3 | GET | `/api/farms/:farmId/zones` | Per-zone aggregates incl. computed status |
| 4 | GET | `/api/farms/:farmId/nodes` | Nodes for a farm (with zone names) |
| 5 | GET | `/api/nodes/:nodeId` | Single node detail |
| 6 | POST | `/api/nodes` | Register node (201) |
| 7 | GET | `/api/farms/:farmId/telemetry/trend?hours=24` | Hourly avg moisture per zone |
| 8 | GET | `/api/farms/:farmId/alerts?status=active\|acknowledged` | Alerts (filter optional) |
| 9 | PATCH | `/api/alerts/:alertId/acknowledge` | Acknowledge alert |
| 10 | GET | `/api/farms/:farmId/irrigation/schedules` | Schedules per farm (recurring + one-time rows) |
| 11 | PATCH | `/api/irrigation/schedules/:id` | Update schedule (partial; one-time retime via `scheduledStart`/`scheduledEnd`) |
| 12 | POST | `/api/irrigation/schedules/:id/start` | Manual start of THIS schedule's node (runs the schedule's own duration) |
| 13 | GET | `/api/farms/:farmId/irrigation/logs` | Watering history, skip reasons inline |
| 13b | POST | `/api/nodes/:nodeId/irrigation/schedules` | Create schedule — body discriminated on `scheduleType`: `"recurring"` (startTime/repeatDays/moistureThreshold) or `"one_time"` (scheduledStart/scheduledEnd/moistureThreshold?) |
| 13c | DELETE | `/api/irrigation/schedules/:id` | Delete a schedule (204; audited `schedule_deleted`) |
| 13d | POST | `/api/nodes/:nodeId/irrigation/start` | Open-ended manual Open — empty body, valve stays open until Close (no duration/cutoff) |
| 13e | POST | `/api/nodes/:nodeId/irrigation/stop` | Manual Close — closes the open log, meters water |

### Platform-admin management API (every route gated by `requireAdminUser`)

All mutation/management lives here; the frontend surfaces it through the
**Settings** page (Platform View) — `/admin` is a read-only overview +
farm-context switcher.

| # | Method | Path | Description |
|---|--------|------|-------------|
| 14 | GET | `/api/admin/overview` | Platform-wide aggregate COUNTs (only unscoped cross-tenant data, aggregates only) |
| 15 | GET | `/api/admin/orgs` | Orgs + nested per-farm stats (`?includeInactive=true`) |
| 16 | GET | `/api/admin/farms/:farmId/users` | Users of a farm's org (Manage Users panel) |
| 17 | POST | `/api/admin/users` | Create farmer/technician on an existing org+farm (201) |
| 18 | PATCH | `/api/admin/users/:userId` | Edit `name`/`email`/`active` — `active:false` revokes login access |
| 19 | DELETE | `/api/admin/users/:userId` | Archive-or-hard-delete (archives if activity history exists) |
| 20 | PATCH | `/api/admin/farms/:farmId` | Edit farm details / reassign to another org (`orgId`) |
| 21 | DELETE | `/api/admin/farms/:farmId` | Archive-or-hard-delete farm |
| 22 | POST | `/api/admin/orgs/:orgId/farms` | Add a farm to an EXISTING org |
| 23 | DELETE | `/api/admin/orgs/:orgId` | Guards: 400 if any farm (active or archived) or user is still attached, 404 if org missing, else hard delete → `{deleted, farmCount, userCount}` |

### Tenant isolation — org **and** per-farm scoping

A client **farmer** is locked to exactly **one** farm (`users.farm_id`), not just
to their organization. This is the critical distinction the schema enforces:
an org may own many farms, but a farmer operates one — so a farmer must never
see a *sibling* farm in the same org, and editing a farmer's email/name must
never touch another farm's operator.

- `users.farm_id UUID REFERENCES farms(id)` — required for `farmer`, `NULL` for
  `admin`/`technician` (staff are platform-scoped, org-less). Enforced by the
  `users_role_org_farm_check` constraint in
  `migrations/1700000018000_users_farm_scope.js`.
- `GET /api/farms` returns a farmer only their own farm; a sibling farm's
  dashboard/zones/nodes/alerts return **403**.
- Farmer accounts are created/edited through the Manage Users panel with an
  explicit `farmId`; the backend validates the farm belongs to the org before
  persisting `farm_id`.

### Example calls

Grab IDs first:

```bash
FARM_ID=$(curl -s http://localhost:4000/api/farms | jq -r '.[0].id')
SCHEDULE_ID=$(curl -s http://localhost:4000/api/farms/$FARM_ID/irrigation/schedules | jq -r '.[0].id')
```

```bash
# 1. Farms
curl http://localhost:4000/api/farms

# 2. Dashboard
curl http://localhost:4000/api/farms/$FARM_ID/dashboard

# 3. Zones — note "disconnected" for Terraced Basin (its only node is offline)
curl http://localhost:4000/api/farms/$FARM_ID/zones | jq

# 4–5. Nodes
curl http://localhost:4000/api/farms/$FARM_ID/nodes | jq
curl http://localhost:4000/api/nodes/SN-RG-01 | jq

# 6. Register a node (id optional — auto-generated when omitted)
curl -X POST http://localhost:4000/api/nodes \
  -H "Content-Type: application/json" \
  -d "{\"farmId\":\"$FARM_ID\",\"name\":\"Node 07 — Test\",\"commMethod\":\"wifi\"}"

# 7. Trend (default 24h; accepts 1..720)
curl "http://localhost:4000/api/farms/$FARM_ID/telemetry/trend?hours=24" | jq '.zones[0]'

# 8. Alerts
curl "http://localhost:4000/api/farms/$FARM_ID/alerts?status=active" | jq

# 9. Acknowledge (userId accepted until Part 10 adds real auth)
ALERT_ID=$(curl -s "http://localhost:4000/api/farms/$FARM_ID/alerts?status=active" | jq -r '.[0].id')
USER_ID=$(docker exec agrigat-timescaledb psql -U agrigat_user -d agrigat_db -tAc \
  "SELECT id FROM users WHERE role='admin' LIMIT 1")
curl -X PATCH http://localhost:4000/api/alerts/$ALERT_ID/acknowledge \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\"}" | jq

# 10–11. Schedules: list, then disable/enable
curl http://localhost:4000/api/farms/$FARM_ID/irrigation/schedules | jq
curl -X PATCH http://localhost:4000/api/irrigation/schedules/$SCHEDULE_ID \
  -H "Content-Type: application/json" -d '{"active": false, "durationMinutes": 50}' | jq

# 12. Manual start of a schedule — drives THIS schedule's node for its own duration
curl -X POST http://localhost:4000/api/irrigation/schedules/$SCHEDULE_ID/start | jq

# 12b. Per-node OPEN-ENDED manual start — empty body, runs until /stop (no duration, no cutoff)
curl -X POST http://localhost:4000/api/nodes/SN-RG-01/irrigation/start -H "Content-Type: application/json" -d '{}' | jq

# 13. History — skipped rows always include their reason inline
curl http://localhost:4000/api/farms/$FARM_ID/irrigation/logs | jq '.[0:3]'
```

### Error examples

```jsonc
// 400 — zod validation failure
{ "error": "Invalid request: body.name — name is required", "details": [{ "path": "body.name", "message": "name is required" }] }

// 404
{ "error": "Node \"SN-NOPE\" not found" }

// 500
{ "error": "Internal server error" }
```

---

## GPS Farm Map (`/map`)

Replaces the old static/placeholder SVG with a real interactive, GPS-based
map. Frontend-only (Leaflet + OpenStreetMap + Geoman) layered on top of the
existing geospatial columns — **no schema migration was required**.

### Library choice

| Library | Purpose | Why |
|---|---|---|
| `leaflet` (1.9) | base mapping engine | mature, lightweight, no API key |
| `react-leaflet` (4.2) | React bindings for Leaflet | idiomatic React 18 component tree over Leaflet |
| `@geoman-io/leaflet-geoman-free` (2.20) | polygon drawing / editing | free, no key, `map.pm` API |

Tiles load from **OpenStreetMap** (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
with proper attribution — no API key required.

The map is browser-only, so it is loaded with
`next/dynamic(() => import(...), { ssr: false })` and never executes during
server rendering.

### The four modes

One map component (`components/map/MapCanvas.tsx`), switched by a mode toggle
in the page header (`app/map/page.tsx`). **Farmer sees VIEW only** — the
Drawing/Reposition mode buttons are hidden entirely (not just disabled).

| Mode | Available to | Behavior |
|---|---|---|
| **VIEW** (default) | everyone | renders farm boundary outline, each zone as a distinct colored semi-transparent polygon, and node markers colored by status; click a marker to open the **same** `NodeDetailModal` used elsewhere. Read-only. |
| **Draw Farm Boundary** | technician/admin | Geoman polygon draw → “Save” persists; “Cancel” discards without a reload. |
| **Draw Zone Boundary** | technician/admin | zone picked from a dropdown, Geoman polygon draw constrained visually within the farm → “Save” persists per-zone. |
| **Reposition Nodes** | technician/admin | node markers become draggable; drags are **visual only** until “Save Positions” (never auto-saved); “Cancel” reverts instantly to the last-saved position. |

### Which API fields the map reads / writes

Read (any authenticated role):

- `GET /api/farms/:farmId/spatial` → `{ boundaryGeojson, centerLat, centerLon, latitude, longitude, totalAreaHa }`
- `GET /api/farms/:farmId/zones` → per-zone `boundaryGps` (added to the zone summary DTO)
- `GET /api/farms/:farmId/nodes` → per-node `lat` / `lon` (already present)

Write (gated, see Permissions):

- `PATCH /api/farms/:farmId/boundary` body `{ boundaryGeojson, totalAreaHa, centerLat?, centerLon? }` → `farms.boundary_geojson` / `total_area_ha` / `center_lat` / `center_lon`
- `PATCH /api/zones/:zoneId` body `{ boundaryGps, areaHectares }` → `zones.boundary_gps` / `area_hectares`
- `PATCH /api/nodes/:nodeId` body `{ lat, lon }` → `nodes.lat` / `nodes.lon`

### Automatic area calculation & deprecated legacy fields

Zone (`area_hectares`) and farm (`total_area_ha`) area are **no longer entered
manually** — they are auto-calculated from the drawn GPS boundary using
[turf.js](https://turfjs.org) at save time (`turf.area(polygon) / 10000`) and
stored in the **same request** that saves the boundary. The frontend computes
the value (`components/map/autoPlace.ts` → `geoAreaHectares`) and sends it
alongside `boundaryGps`/`boundaryGeojson`; the backend stores it directly and
only recomputes as a fallback for callers that send a boundary alone.

- The Add/Edit Zone modal (Settings) and Farm Identity card show the current
  computed area as **read-only** text (`"…ha (calculated from drawn boundary)"`,
  or `"not yet calculated — draw a boundary on the Farm Map"` when no boundary
  exists) instead of a manual input.
- The value updates automatically whenever a boundary is drawn or reshaped via
  Edit Boundary mode.

**`farms.map_x` / `farms.map_y` (node `map_x`/`map_y`, exposed as `x`/`y`) are
DEPRECATED.** They were 0–100 percentage placeholder coordinates for the retired
static SVG map and are fully superseded by real GPS (`lat`/`lon`), which now
drives node placement (drag-and-drop on the farm map, or auto-placement inside
a zone). The database columns are kept as-is (no destructive migration) and the
backend still auto-maintains them from GPS for legacy readers, but **no
frontend code reads or writes them** — positioning is lat/lon only.

### Automatic node placement (create & zone change)

Auto-placement is not only triggered when a **zone boundary** is saved (where
the Farm Map stages positions and saves them after the operator confirms) — it
is also applied **server-side** when a node is registered or moved:

- **Create (`POST /api/nodes`)** — a node created with a `zoneId` whose zone
  has a drawn boundary and **no explicit `lat`/`lon`** is placed inside that
  boundary during the same request; the response returns the real GPS.
- **Zone change (`PATCH /api/nodes/:nodeId`)** — when `zoneId` is being set or
  changed and the caller did not supply a genuinely new GPS position, the node
  is repositioned inside the **new** zone's boundary. The edit modal re-sends a
  node's own unchanged stored `lat`/`lon`, which does **not** suppress
  repositioning.
- **Explicit GPS always wins** — a caller-provided `lat`/`lon` (or the Farm
  Map's Reposition save) is stored verbatim and skips auto-placement.
- **Boundary-less zone** — placement never runs against a zone without a drawn
  boundary: the node keeps whatever position it has (or `null`), exactly as on
  create into a zone with no boundary yet, and is placed later when the
  boundary gets drawn (existing boundary-save flow).
- Positions are picked with the same turf logic as the boundary-save path
  (`src/services/geo.ts` → `autoPlacePointInside`: random points in the
  polygon's bbox with index-based jitter, centroid fallback) so several
  quickly-created nodes land on distinct points.

### Permissions

Gated by `zones.edit` / `nodes.edit` (technician + admin) — **not**
`farmIdentity.edit` (farmer holds that) and not the platform-admin console.
Per the capability model:

- **technician / admin**: hold `zones.edit` + `nodes.edit` → can draw farm/zone
  boundaries and reposition nodes. Mode buttons visible.
- **farmer**: holds neither → VIEW only; no buttons; direct API calls to the
  three PATCH endpoints return **403**.

