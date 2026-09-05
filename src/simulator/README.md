# AgriGate Virtual Node Simulator (Part 6)

Simulates the fleet of ESP32 sensor nodes against the Part 4 Mosquitto broker and Part 2 seeded data — one virtual node per **active** node (`status <> 'offline'`) in the database.

Purpose:
1. Prove the full cloud pipeline end-to-end: `simulator → MQTT → ingestion → TimescaleDB → REST API`
2. Prototype the **buffer/retry** behavior that the real firmware (Part 5) will copy

---

## Running

```bash
# prerequisites: docker compose up -d  (mosquitto + timescaledb)
npm run mqtt:start        # terminal 1 — ingestion service
npm run simulate          # terminal 2 — virtual node farm

# or one-shot with custom pacing
SIMULATE_INTERVAL_MS=15000 npm run simulate
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SIMULATE_INTERVAL_MS` | `15000` | Publish cycle per node. Real firmware uses 5 min; keep it fast in dev to see behavior without waiting |
| `SIMULATE_UNRELIABLE_WIFI` | `true` | When `true`, each node independently has a **90 % chance of keeping / 10 % chance of flipping** its link state each cycle → realistic multi-cycle outages. Set `false` for always-connected runs |
| `MQTT_BROKER_URL` | from `.env` | Broker URL (host-mapped port, e.g. `mqtt://localhost:1884`) |

## Per-node behavior

Each virtual node:

1. Generates a reading via `diurnalModel.ts` (the **shared** solar/humidity curve module — `scripts/seed.ts` uses the exact same model, so simulated values continue seamlessly from seeded history; moisture anchors on each node's latest stored reading)
2. Rolls its connection state machine
3. **Connected** → publishes to `agrigate/{orgId}/{farmId}/{nodeId}/telemetry` (QoS 1)
4. **Disconnected** → pushes the reading to an in-memory buffer (**cap 100**, oldest dropped when full — mirrors the ESP32 SPIFFS queue shrunk from 10,000)
5. On restore → flushes the buffer **chronologically**, paced ~60–100 ms apart so ingestion isn't burst-hit, then resumes live publishing

### Buffer/retry contract (what Part 5 firmware must copy)

- `timestamp` is set at **generation time**, never at publish/flush time — a buffered reading keeps its true measurement moment through any outage
- Flush order is chronological
- Every generated payload is re-validated against the Part 4 zod contract before publishing; an invalid payload is dropped locally and logged

### Battery & RSSI

- Battery starts from `nodes.battery` and drains **~0.01 %/cycle** so long-running tests eventually cross low-battery thresholds
- RSSI fluctuates ±3 dBm around the node's seeded base

## MQTT client identity

Each node connects with client id = `nodes.mqtt_client_id` (migration 0005 backfills this to the node serial). Running two simulator instances against the same broker will make brokers kick the older session per id — by design, mirroring a replaced device.

## Reading the logs

One line per node per cycle:

```text
[NODE SN-RG-01] Node 01 — North Ridge | 💧54.3% 🌡24.9°C 🔋93.9% 📶-58dBm LIVE
[NODE SN-RG-04] Node 04 — South Gully | 💧36.1% 🌡25.0°C 🔋41.9% 📶-80dBm BUFFERED (n=3 queued)
[NODE SN-RG-04] connection LOST — entering buffered mode
[NODE SN-RG-04] connection RESTORED — flushing 4 buffered reading(s)
[NODE SN-RG-04] Node 04 — South Gully | 💧35.8% 🌡25.1°C 🔋41.8% 📶-79dBm FLUSHED (buffer→0) ts=2026-08-22T09:12:03.114Z
```

`LIVE` = published immediately · `BUFFERED` = link down, queued · `FLUSHED` = backlog replay after reconnect (note the preserved original `ts=`)

## Verifying the pipeline

```bash
# rows arriving per node (timestamps should match simulator log lines)
docker exec agrigat-timescaledb psql -U agrigat_user -d agrigat_db -c \
  "SELECT node_id, COUNT(*), MAX(time) FROM telemetry GROUP BY node_id ORDER BY node_id;"

# full path while the simulator runs — moisture should move between calls
curl -s http://localhost:4000/api/farms/$FARM_ID/zones | jq '.[].moisture'
```

Dedupe safety: if a flushed reading's `(node_id, time)` already exists (e.g. replayed queue), the ingestion service's `ON CONFLICT DO NOTHING` silently skips it — no crash, no duplicate row.
