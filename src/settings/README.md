# AgriGate Settings System (Part 11)

Per-farm configurable thresholds replacing the Part 8 global constants, plus
per-node telemetry cadence overrides pushed live over MQTT.

## How it works

```text
GET/PATCH /api/farms/:farmId/settings
  defaults.ts (platform fallbacks)
    └── merged with rows in `settings` table → one flat object

PATCH /api/nodes/:nodeId { read_interval_ms }
  └── UPDATE nodes.read_interval_ms (null = use farm default)
  └── publish RETAINED msg → agrigate/{orgId}/{farmId}/{nodeId}/config
```

The alert engine (`alertEngine.evaluateTelemetryReading`) calls
`settingsService.getSettings(farmId)` on **every evaluated reading**, so a
threshold change takes effect from the very next frame a node publishes.

## Settings keys & roles

| Key | Default | Unit | View | Edit |
|---|---|---|---|---|
| `moistureLow` | `30` | % | any role | technician+ |
| `moistureHigh` | `85` | % | any role | technician+ |
| `batteryLow` | `20` | % | any role | technician+ |
| `batteryCritical` | `10` | % | any role | technician+ |
| `nitrogenLow` | `100` | ppm | any role | technician+ |
| `phosphorusLow` | `20` | ppm | any role | technician+ |
| `potassiumLow` | `70` | ppm | any role | technician+ |
| `soilTempLowExtreme` | `5` | °C | any role | technician+ |
| `soilTempHighExtreme` | `35` | °C | any role | technician+ |
| `offlineMinutes` | `10` | min | any role | technician+ |
| `irrigationMaxRunningMinutes` | `240` | min | any role | technician+ |

All keys follow the full three-tier precedence (node > farm > default) —
including `offlineMinutes`: the offline sweep resolves each node's effective
silence threshold individually, so one node can tolerate 20 minutes while its
sibling flags after 5. `irrigationMaxRunningMinutes` drives the long-running
irrigation warning (replaces the old max-runtime cutoff — it only *warns*,
never force-closes a valve).

Validation: unknown keys rejected; values bounded (see `SETTINGS_BOUNDS`);
cross-field sanity enforced (`low < high`, `batteryCritical <= batteryLow`);
writes are all-or-nothing per PATCH.

## Node read interval

| Field | Meaning |
|---|---|
| `nodes.read_interval_ms` | per-node cadence override (≥ 1000 ms); **NULL = farm default** (`DEFAULT_READ_INTERVAL_MS = 60000`) |

On `PATCH /api/nodes/:nodeId` success, the API publishes a **retained** MQTT
message so the value survives broker restarts and reaches nodes that are
offline right now:

```text
Topic:   agrigate/{orgId}/{farmId}/{nodeId}/config   (retain flag set)
Payload: {"readIntervalMs": 120000}                  // or null for reset
```

### ⚠ FIRMWARE REQUIREMENT (Part 5 — no code yet)

Part 5's `MqttConnection` module MUST:

1. Subscribe to `agrigate/{orgId}/{farmId}/{nodeId}/config` on EVERY connect,
2. Apply `readIntervalMs` **at runtime** when a retained/live message arrives
   — not just read `READ_INTERVAL_MS` once from `config.h` at boot,
3. Treat `readIntervalMs: null` as "revert to the compiled default".

## Three-tier precedence (Part 13)

Per-node overrides layer on top of farm settings:

```text
node_settings (per node)   ← wins
  ↑ fallback to
settings (per farm)        ← PATCH /api/farms/:farmId/settings
  ↑ fallback to
defaults.ts                ← platform hardcoded values
```

Same key namespace at every tier — the merge is a simple lookup, no translation.

- `GET /api/nodes/:nodeId/settings` → `{ values: {...}, sources: {...} }` where each source is `'default' | 'farm' | 'node'`
- `PATCH /api/nodes/:nodeId/settings` → upserts node-level overrides (technician+)
- `DELETE /api/nodes/:nodeId/settings/:key` → removes one override; the key reverts to the farm setting or default (technician+)
- The alert engine resolves these per reading — one node can run stricter thresholds than its siblings on the same farm

## Role gates summary

UI hiding in the frontend is convenience only — these backend middleware
rules are the real boundary (verify with curl + farmer cookie):

| Endpoint | Gate |
|---|---|
| `GET /api/farms/:farmId/settings` | any authenticated role (+ farm access) |
| `PATCH /api/farms/:farmId/settings` | technician+ |
| `GET /api/nodes/:nodeId/settings` | any authenticated role (+ farm access) |
| `PATCH /api/nodes/:nodeId/settings` | technician+ |
| `DELETE /api/nodes/:nodeId/settings/:key` | technician+ |
| `PATCH /api/nodes/:nodeId` | technician+ |
| `GET/POST /api/farms/:farmId/users` | farm-admin (admin role) |
| `DELETE /api/farms/:farmId/users/:userId` | farm-admin (cannot delete self or platform admins) |
| `PATCH /api/farms/:farmId` | farm-admin |
| `POST /api/orgs`, `GET /api/orgs` | platform admin only |

## Node edit & removal (Part 14)

`PATCH/DELETE /api/nodes/:nodeId` (technician+):

- **PATCH** accepts the full config: name, zoneId (must belong to the same
  farm), commMethod, mqttClientId (409 on duplicates), readIntervalMs,
  isActuator, mapX/mapY, lat/lon, sensorCapabilities, flowRateLPerMin,
  maxRuntimeMinutes, installedAt, notes, active.
  - Disabling `isActuator` while active schedules target the node → **400**
  - Actuator-only fields on non-actuator nodes → **400**
  - `maxRuntimeMinutes` below the shortest scheduled run → **400**
  - When `readIntervalMs` is included, the retained `/config` MQTT payload
    `{readIntervalMs, maxRuntimeMinutes}` is re-pushed to firmware
- **DELETE**: mid-irrigation → **409** · zero telemetry AND zero logs →
  hard delete · otherwise → archive (`active=false`) with counts returned.

Archived nodes: hidden from default lists and zone/node dropdowns, shown via
"Show archived nodes" toggles or `?includeInactive=true`, reactivate via
`POST /api/nodes/:nodeId/reactivate`.

## Zone lifecycle (Part 13 ext)

Zones are soft-managed with history-aware removal:

| Action | Gate | Behavior |
|---|---|---|
| `POST /api/farms/:farmId/zones` | farm-admin (admin role) | create; `targetMoisture` validated 0–100 |
| `PATCH /api/zones/:zoneId` | technician+ | edit details; `active: true` = reactivate |
| `DELETE /api/zones/:zoneId` | farm-admin | lifecycle-aware removal |

Removal decision tree:
1. **Nodes assigned** (`COUNT(*) FROM nodes WHERE zone_id`) → **400** with the exact count — reassign or remove nodes first; never cascades.
2. Zero nodes + **historical logs/alerts referencing the zone** → **archive** (`active=false`); records preserved.
3. Zero nodes + zero history → **hard delete**.

Archived zones are excluded from default zone lists, dashboards, and node
assignment dropdowns; visible only via `?includeInactive=true` or the
"Show archived zones" toggle in Settings → Zones, where they can be
reactivated.

## Admin user management (Part 14)

`/api/admin/users` endpoints — all behind `requireAdminUser` (role === 'admin').

| Endpoint | Purpose | Notes |
|---|---|---|
| `PATCH /api/admin/users/:userId` | edit name / email / active flag | duplicate email → **409**; admin accounts → 400 |
| `DELETE /api/admin/users/:userId` | history-aware removal | zero references → hard delete; has references → archive (`is_active=false`) |
| `GET /api/admin/farms/:farmId/users` | list users of a farm's org | farm-admin panel data source |

### Removal decision tree

1. User is an admin → **400** (never removable here)
2. Has FK references in alerts (`acknowledged_by`) → **archive** (`is_active=false`)
3. Zero references → **hard delete**

Archived users can no longer log in but their historical attribution
(`acknowledged_by`, `triggered_by`) remains fully intact.

## Per-node settings page (Part 13 UI)

`/nodes/{nodeId}/settings` — mirrors the farm settings layout: all 10 keys
(including `offlineMinutes`), each field labeled with its effective value and
source badge (DEFAULT / FARM / CUSTOM), "Reset to farm value" links beneath
CUSTOM fields, single Save button PATCHing only changed keys. Farmer role sees
the page read-only. Reached from the node drawer via
"Configure Alert Thresholds →".

## Platform admin console & farm context (Part 12)

### `/admin` — read-only overview & context switch

`/admin` is the staff-only **overview** (requirePlatformAdmin on every
`/api/admin/*` route; the page redirects non-staff clients away). It shows
platform-wide aggregate COUNTs (orgs, farms, nodes, active nodes, open
critical/open alerts — the only unscoped cross-tenant numbers, aggregates
only) plus a click-through org/farm browse list. It has **no mutating
controls**: all management was consolidated into `/settings`.

### `/settings` — the single management surface (Platform View)

Platform admins see, in order:

- **Alert Thresholds** — rendered ONLY while a farm context is active
  (`useFarmContext`). With no farm selected the card is not in the DOM at
  all; clicking a farm in the TopBar switcher shows it above the panels
  below, and it disappears again when the context is cleared.
- **Client Organizations** — nested org → farm list. Per farm: **Edit**
  (rename, recenter lat/lon, or reassign to another org via PATCH `orgId`)
  and **Remove** (archive-or-hard-delete). Per org: **+ Farm** (org-scoped
  farm creation) and **Remove** (guarded — a 400 with its reason surfaces
  inline if farms/users are still attached). Onboard Client creates an
  org + first farm in one transaction.
- **Manage Users** — per-target-farm: create farmer/technician accounts.
  Row actions key off `user.isActive`: **active → Edit + Deactivate**
  (PATCH `active:false`), **deactivated → Reactivate** (PATCH `active:true`)
  + **Delete** (archive-or-hard-delete).

### Farm-context switching

Platform admins have no home org. Clicking a farm in /admin stores
`{farmId, farmName, orgId}` in sessionStorage (`agrigate_farm_context`) —
every farm-scoped page then uses that id via `usePrimaryFarmId()`, so the
NORMAL dashboard/devices/irrigation pages render someone else's farm through
the exact same UI. A "Viewing: {farm} ▾" TopBar switcher (staff-only) jumps
between recently viewed farms or back to /admin. Client users never see this
and remain locked to their own org.
