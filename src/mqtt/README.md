# AgriGate MQTT Ingestion Service (Part 4)

Consumes sensor telemetry and node heartbeats from a local Mosquitto broker and writes validated data into the Part 2 TimescaleDB database.

- **Separate process** from the Part 3 REST API — shares `src/db/pool.ts` (never creates a second pool)
- **Receive-only**: no actuator/device commands here (that is Part 9)
- One bad message never crashes the service: invalid payloads are logged with their raw content and dropped

---

## Running

```bash
# 1. Broker + database
docker compose up -d          # mosquitto (host 1884/9002) + timescaledb (host 5433)

# 2. Dev mode (auto-reload)
npm run mqtt:dev

# or one-shot
npm run mqtt:start
```

> **Host port note:** the container is published as **1884→1883 / 9002→9001** because a local
> Windows Mosquitto service already occupies 1883/9001 on this machine (same reason the DB is
> on 5433). Inside the container network everything stays on 1883/9001.

Environment (`.env`):

| Variable | Default | Purpose |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1884` | Mosquitto broker (host-mapped port) |
| `DATABASE_URL` | shared with Part 3 | Postgres/TimescaleDB |

Startup log confirms connection and both subscriptions:

```text
[mqtt-ingest] starting (broker: mqtt://localhost:1884, pool reuse: shared with API)
[mqtt-ingest] connected to broker mqtt://localhost:1884
[mqtt-ingest] subscribed to agrigate/+/+/+/telemetry (qos 1)
[mqtt-ingest] subscribed to agrigate/+/+/+/status (qos 1)
```

---

## Topic namespace

```text
agrigate/{orgId}/{farmId}/{nodeId}/telemetry   ← sensor readings
agrigate/{orgId}/{farmId}/{nodeId}/status      ← heartbeats
```

Subscriptions use wildcards `agrigate/+/+/+/telemetry` and `agrigate/+/+/+/status`.

**`nodeId` is extracted from the topic (4th segment) — it is NEVER trusted from the payload body.**

### Integrity rule

Before writing anything, the handler checks that the node exists **and** is registered under the `farmId` claimed in its topic. A node publishing under the wrong farm is an integrity violation: it is logged as `🚨 INTEGRITY` and rejected.

---

## Payload contract

### Telemetry (`…/telemetry`) — JSON

| Field | Type | Constraints |
|---|---|---|
| `soilMoisture` | number | 0–100 |
| `nitrogen`, `phosphorus`, `potassium` | number | 0–2000 ppm |
| `soilTemp`, `airTemp` | number | −50–80 °C |
| `airHumidity` | number | 0–100 % |
| `battery` | number | 0–100 % |
| `rssi` | integer | −120–0 dBm |
| `timestamp` | string | OPTIONAL ISO 8601 — server receive time used when absent |

Column mapping: `airHumidity → telemetry.humidity`, `timestamp → telemetry.time`.

### Status heartbeat (`…/status`) — JSON

```json
{ "online": true, "battery": 87 }
```

- `online` flips `nodes.status` between `'online'` / `'offline'`
- `last_seen_at` is refreshed on every heartbeat; `battery` persisted when present

---

## Ingestion rules

1. Parse topic → `{orgId, farmId, nodeId}`
2. Validate payload (zod) — failure ⇒ log raw payload + issues, drop message
3. Node must exist and belong to the claimed farm — otherwise reject + log integrity error
4. Insert into `telemetry` with **`ON CONFLICT (node_id, time) DO NOTHING`** — retried/replayed publishes are idempotent (constraint `uq_telemetry_node_time`, migration 0004)
5. Update `nodes.battery / rssi / last_seen_at`, set `status = 'online'`

### "Node went quiet" sweep

Every **60 s**, any node whose `last_seen_at` is older than **10 minutes** is marked `offline`. This only maintains the node status flag — alert *generation* from these events belongs to Part 8.

---

## Testing with mosquitto_pub

The `eclipse-mosquitto` container ships the client tools, so no local install is needed:

```bash
# IDs for the seeded farm
ORG_ID=$(docker exec agrigat-timescaledb psql -U agrigat_user -d agrigat_db -tAc \
  "SELECT org_id FROM farms LIMIT 1")
FARM_ID=$(docker exec agrigat-timescaledb psql -U agrigat_user -d agrigat_db -tAc \
  "SELECT id FROM farms LIMIT 1")
```

Valid telemetry to real seeded node `SN-RG-01`:

```bash
docker exec agrigat-mosquitto mosquitto_pub -h localhost -p 1884 \
  -t "agrigate/$ORG_ID/$FARM_ID/SN-RG-01/telemetry" \
  -m '{"soilMoisture":54.2,"nitrogen":225,"phosphorus":56,"potassium":188,"soilTemp":24.6,"airTemp":31.2,"airHumidity":38.5,"battery":93,"rssi":-58}'
```

Confirm the row landed:

```bash
docker exec agrigat-timescaledb psql -U agrigat_user -d agrigat_db -c \
  "SELECT time, soil_moisture, battery FROM telemetry WHERE node_id='SN-RG-01' ORDER BY time DESC LIMIT 3;"
```

Invalid payload (missing required `soilMoisture`) — logged and dropped, service keeps running:

```bash
docker exec agrigat-mosquitto mosquitto_pub -h localhost -p 1884 \
  -t "agrigate/$ORG_ID/$FARM_ID/SN-RG-01/telemetry" \
  -m '{"nitrogen":200,"phosphorus":50,"potassium":180,"soilTemp":24,"airTemp":30,"airHumidity":40,"battery":90,"rssi":-60}'
```

Dedupe check — publish the exact same valid message twice; only one row exists (the second logs `↺ duplicate ignored`).

Heartbeat test:

```bash
docker exec agrigat-mosquitto mosquitto_pub -h localhost -p 1884 \
  -t "agrigate/$ORG_ID/$FARM_ID/SN-RG-03/status" \
  -m '{"online": false, "battery": 71}'
```

Watch the ingest trail live:

```bash
docker exec agrigat-mosquitto mosquitto_sub -h localhost -t 'agrigate/#' -v
```

---

## Logging discipline

Every one of these produces a log line — silent failures here would make field connectivity undebuggable:

- broker connect / reconnect / connection errors
- each subscription confirmation (topic + qos)
- every ingested message: one line with node id + timestamp (+ moisture/battery/rssi)
- duplicates: `↺ duplicate ignored …`
- validation failures: raw payload + per-field zod issues
- unknown nodes, farm-mismatch integrity violations
- quiet-node sweep results and any DB error
