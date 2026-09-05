# AgriGate Irrigation Command Path & Scheduler (Part 9 + per-node + one-time extension)

Valve commands target a **specific actuator node** (Part 9 ext), not "the zone's single actuator". Automated schedule execution extends the Part 4 ingestion process. Schedules are **per-node** and come in two types:

- **recurring** — `start_time` (local HH:MM) + `repeat_days` + optional `moisture_threshold`; fires on matching minutes (legacy behaviour).
- **one_time** — `scheduled_start` / `scheduled_end` (ISO instants, duration = end − start) + optional `moisture_threshold`; fires on the scheduled minute and is stamped `fired_at` (fire, moisture-skip and actuator-conflict all stamp it — a processed one-time run is **never** retried).

## Frontend drill-down (UI restructure, Part 10)

The Irrigation section is now a card-driven 3-screen flow:

| Screen | Route | Content |
|---|---|---|
| 1 | `/irrigation` | Zone cards: name, crop, status + moisture hero, aggregate strip (nodes / valves / sensors / active schedules) |
| 2 | `/irrigation/{zoneId}` | This zone's node cards — status dot, Actuator vs Sensor badge, soil/battery/signal strip, **live actuators** (Open/Close confirm-gated, polled every 20 s), Schedule button → ScheduleModal |
| 3 | `/irrigation/{zoneId}/{nodeId}` | Legacy full dashboard (kept as deep link from the drawer/zone page): valve control, schedules, run history, telemetry charts |

Node cards open a **NodeDetailDrawer** (slide-in over the zone page) instead of a sub-route. Sensor-only nodes never show control/schedule sections; nodes with zero telemetry rows get an explicit "No telemetry data" state. All valve actions pass through ConfirmDialog (farmer role is read-only).

## Command topic

```text
agrigate/{orgId}/{farmId}/{nodeId}/commands
```

| Action | Payload |
|---|---|
| Start | `{ "action": "irrigate_start", "durationMinutes"?: 45, "logId": "uuid" }` |
| Stop | `{ "action": "irrigate_stop", "logId": "uuid" }` |

QoS 1. `logId` links the run to its `irrigation_logs` row. **`durationMinutes` is optional**: present → programmed run the device self-closes after that many minutes (scheduled recurring/one-time irrigation); **absent → open-ended run that stays open until `irrigate_stop`** (manual Open — no duration is ever requested or sent, and nothing force-closes it). Completion is reported on the node's **status** topic; ingestion closes the row: `ended_at = now()`, `water_used_litres = elapsed minutes × 16 L/min`.

## Node-level model

- `irrigation_schedules.node_id` (migration 0009) — each schedule drives ONE node; `zone_id` kept denormalized for zone-scoped moisture gating/history.
- Application-level rule: schedules can only be created on `is_actuator = true` nodes → otherwise **400**.
- A node runs **one open cycle at a time**: start while running → **409**. Open run = latest `irrigation_logs` row with `ended_at IS NULL AND skipped = FALSE`.
- One-time creation validation (superRefine on the discriminated union): `scheduled_end > scheduled_start`, start in the future, duration ≤ node `max_runtime_minutes` (else **400**), optional `moisture_threshold` (null = always fire).
- **Manual Open is open-ended**: no duration is requested or sent, and there is no max-runtime cutoff on the control path. Instead, the 2-minute periodic sweep (`src/alerts/offlineSweep.ts`) raises a **`irrigation_long_running`** warning once an open run passes the node's effective `irrigationMaxRunningMinutes` (default 240, defaults < farm < node) — notification only, **never** a force-close.

### Endpoints (node-scoped)

| Method | Path | Gate | Notes |
|---|---|---|---|
| GET | `/api/zones/:zoneId/nodes` | auth + farm access | zone-expand UI data (includes `maxRuntimeMinutes` + latest telemetry) |
| GET | `/api/nodes/:nodeId/irrigation/schedules` | auth + access | this node's schedules |
| POST | `/api/nodes/:nodeId/irrigation/schedules` | technician+ | body discriminated on `scheduleType`; 400 if non-actuator / no zone |
| GET | `/api/nodes/:nodeId/irrigation/status` | auth + access | `{ isRunning, currentLog }` |
| POST | `/api/nodes/:nodeId/irrigation/start` | any role | body **empty** (open-ended — no duration, no cutoff); 409 if already running |
| POST | `/api/nodes/:nodeId/irrigation/stop` | any role | closes the open log; 409 if nothing running |
| PATCH | `/api/irrigation/schedules/:id` | technician+ | partial; one_time row supports retime (`scheduledStart`/`scheduledEnd` → resets `fired_at`); mixing recurring/one_time fields → 400 |
| DELETE | `/api/irrigation/schedules/:id` | technician+ | 204; audited as `schedule_deleted` |

`POST /api/irrigation/schedules/:id/start` still exists for compatibility — it fires the schedule's own node (falling back to the zone actuator for pre-migration rows).

## Scheduler (`src/irrigation/scheduler.ts`)

Minute-aligned tick inside the always-on ingest process (`src/mqtt/ingest.ts`). Each tick evaluates **recurring** and **one-time** due sets:

1. Recurring: active matching local HH:MM + DOW, INNER-JOINed to a valid actuator node, double-fire guard per minute.
2. One-time: `scheduled_start <= now AND fired_at IS NULL AND active`, joined to a valid actuator node, same per-minute guard.
3. Moisture gate per node: schedule threshold vs node's latest reading (recurring uses the shared `zoneService.getZoneMoistures` aggregate; one-time uses the node DTO's live value). `NULL` threshold = always fire; no live reading = skip — never irrigate blind.
4. Before firing either type: if the node already has an open run → **skip + stamp** (`skipped log + reason`, and for one-time `fired_at`).
5. Fired rows are OPEN (`ended_at = NULL`) until completion/stop; one-time rows are stamped `fired_at = NOW()` in **all** outcomes.

## Simulated actuator (simulator)

Actuator-flagged virtual nodes subscribe to their `/commands` topic and log `IRRIGATION STARTED / COMPLETE`. When `irrigate_start` carries a `durationMinutes`, they run a real timer for that many minutes and self-close. When the payload has **no duration** (manual Open) they hold the valve open with **no timer** until `irrigate_stop` — the exact "no safety-cutoff" firmware behaviour. `irrigate_stop` closes early (or at any time for an open-ended run) and reports the same completion shape.

## Failure semantics invariant

A log row must never claim irrigation ran when the command didn't leave the server. Delivery failures rewrite the just-created row to `skipped=true` inline with a visible reason.