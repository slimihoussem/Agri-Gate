# AgriGate Alert Engine (Part 8)

Generates alerts automatically from incoming telemetry and node silence — no more manually seeded rows. Extends the Part 4 ingestion process; adds a periodic sweep.

```text
telemetry frame → Part 4 handler → INSERT → alertEngine.evaluateTelemetryReading()
                                              └→ createAlertIfNotExists() per breach
2-min sweep (same process)   → checkOfflineNodes() → status flip + node_offline alert
                            → runLongRunningIrrigationCheck() → irrigation_long_running alert
```

## Files

| File | Role |
|---|---|
| `../settings/defaults.ts` | **Single source of truth** for every default threshold + validation bounds. Both the event-driven engine and the sweep resolve values through here — never hardcode a number twice |
| `alertEngine.ts` | Pure logic: `evaluateTelemetryReading(reading, node)` and `checkOfflineNodes(nodes)`. Returns candidates; touches no MQTT/SQL/HTTP |
| `offlineSweep.ts` | Every 2 min: flag silent nodes offline + create `node_offline` alerts, **and** check open irrigation runs past their `irrigationMaxRunningMinutes` for `irrigation_long_running` warnings. Started from `src/mqtt/ingest.ts` so all always-on logic shares one process |
| `../services/alertService.ts` → `createAlertIfNotExists()` | Persistence + dedupe (below) |

## Alert types & thresholds

| Type | Trigger | Severity | Example message |
|---|---|---|---|
| `moisture_low` | soil moisture < **30 %** | critical | "Soil moisture critically low: 24% (threshold: 30%). Olive roots are in water stress…" |
| `moisture_high` | soil moisture > **85 %** | warning | waterlogging risk message with actual value |
| `battery_low` | battery < **20 %** | warning | schedule maintenance message |
| `battery_critical` | battery < **10 %** | critical | replace/recharge now |
| `nitrogen_low` | N < **100 ppm** | warning | fertilisation recommended |
| `phosphorus_low` | P < **20 ppm** | warning | fertilisation recommended |
| `potassium_low` | K < **70 ppm** | warning | fertilisation recommended |
| `soil_temp_extreme_low` | soil temp < **5 °C** | critical | frost risk |
| `soil_temp_extreme_high` | soil temp > **35 °C** | critical | heat stress |
| `node_offline` | silent ≥ **10 min** (swept every 2 min) | critical | 'Node "SN-RG-06" has not reported in over 10 minutes…' |
| `irrigation_long_running` | open run ≥ **240 min** (swept every 2 min; per-node threshold) | warning | 'Node "SN-RG-01" has been irrigating for over 240 minutes. Check for a stuck valve or forgotten shutoff.' |

Every message includes the actual measured value AND the threshold — readable on a phone without opening the app.

One reading can trigger multiple types at once (e.g. low moisture + low battery): each becomes its own candidate, deduped independently per `(node_id, type)`.

## Dedupe logic (`createAlertIfNotExists`)

Before inserting:

```sql
SELECT id FROM alerts
WHERE node_id = $1 AND type = $2 AND acknowledged_at IS NULL
LIMIT 1
```

- **Unacknowledged duplicate exists** → skip + log ("already tracking this issue"). A breaching condition generates exactly ONE open alert no matter how many readings confirm it.
- **No open duplicate** → insert. `farm_id`/`zone_id` are pulled from the node row inside the INSERT.
- **Acknowledged duplicates do NOT block**: once an operator acknowledges an occurrence, a genuinely NEW breach of the same type creates a fresh alert. Acknowledging closes an occurrence, it never disables detection.
- Unknown `nodeId` → logged and dropped (defends against rogue publishers).

## No auto-resolve (intentional)

There is **no code path that sets `acknowledged_at` automatically** when readings return to normal. Alerts clear only through `PATCH /api/alerts/:alertId/acknowledge` — a human decision.

Why: if moisture dips below 30 % at dawn then recovers by noon, auto-resolution would erase the evidence. The farmer must be able to see that something WAS wrong. The same applies to `node_offline`: a node coming back online flips its status to `online`, but its offline alert stays until acknowledged. The same applies to `irrigation_long_running`: closing the valve closes the `irrigation_logs` row, but the warning stays until acknowledged.

There is also **no force-close**: the long-running sweep only ever *warns*. The valve state is never mutated by the alert engine — manual Close (or a scheduled run's own duration) is the only thing that ever stops an open run.

## Testing notes

- Normal simulator output (~30–52 % moisture) produces zero alerts — Zone B sits near the 30 % line and may legitimately trigger one `moisture_low` per node.
- To force a breach for testing, temporarily raise `moistureLow` above simulated values in `defaults.ts`, restart the ingest process, publish several readings, and confirm exactly one open alert per node/type regardless of reading count. Revert afterwards.
- Offline sweep timing: backdate `nodes.last_seen_at` via SQL to simulate silence instead of waiting 10+ minutes; the next 2-minute tick flags the node and files the alert.
- Long-running sweep timing: lower a node's `irrigationMaxRunningMinutes`, open the valve (open-ended — no duration), and backdate the open `irrigation_logs.started_at` via SQL; the next 2-minute tick files exactly ONE `irrigation_long_running` warning and the run stays open.
