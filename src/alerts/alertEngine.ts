import type { TelemetryPayload } from "../mqtt/schemas/telemetryPayload.schema";
import { getEffectiveThresholds } from "../settings/settingsService";

/**
 * Alert engine — Part 8 (+ Part 11 farm settings, + Part 13 node overrides).
 *
 * Evaluates a reading against the NODE'S FULLY-RESOLVED thresholds:
 *   hardcoded defaults ← farm `settings` overrides ← node_settings overrides
 * via settingsService.getEffectiveThresholds(node.id). Returns what alerts
 * SHOULD exist; touches no MQTT or HTTP. Persistence happens in
 * services/alertService.createAlertIfNotExists.
 *
 * A single reading can yield MULTIPLE candidates (e.g. low moisture AND low
 * battery in the same frame) — callers create each one; dedupe is handled
 * downstream per (nodeId, type).
 */

export type AlertSeverityValue = "info" | "warning" | "critical";

export interface AlertCandidate {
  type: string;
  severity: AlertSeverityValue;
  /** Human-readable, includes the actual measured value AND the threshold. */
  message: string;
  value: string | null;
}

export interface TelemetryReadingInput {
  id: string;
  name: string;
  farmId: string;
}

/** Nodes inspected by checkOfflineNodes: minutes since last heartbeat/report. */
export interface NodeSilenceInput {
  id: string;
  name: string;
  minutesSilent: number;
}

const fmtPct = (v: number): string => `${Math.round(v * 10) / 10}%`;
const fmtPpm = (v: number): string => `${Math.round(v)} ppm`;
const fmtTemp = (v: number): string => `${Math.round(v * 10) / 10}°C`;

export async function evaluateTelemetryReading(
  reading: TelemetryPayload,
  node: TelemetryReadingInput
): Promise<AlertCandidate[]> {
  // Three-tier resolution: defaults < farm overrides < THIS node's overrides.
  const { values: t } = await getEffectiveThresholds(node.id);
  const candidates: AlertCandidate[] = [];

  // ── Soil moisture (optional — node may not have the sensor) ──────────────
  if (reading.soilMoisture != null && reading.soilMoisture < t.moistureLow) {
    candidates.push({
      type: "moisture_low",
      severity: "critical",
      message: `Soil moisture critically low: ${fmtPct(reading.soilMoisture)} (threshold: ${t.moistureLow}%). Olive roots are in water stress — consider an irrigation cycle.`,
      value: fmtPct(reading.soilMoisture),
    });
  } else if (reading.soilMoisture != null && reading.soilMoisture > t.moistureHigh) {
    candidates.push({
      type: "moisture_high",
      severity: "warning",
      message: `Soil moisture above optimal: ${fmtPct(reading.soilMoisture)} (threshold: ${t.moistureHigh}%). Waterlogging risk — check drip lines for leaks.`,
      value: fmtPct(reading.soilMoisture),
    });
  }

  // ── Battery ──────────────────────────────────────────────────────────────
  if (reading.battery < t.batteryCritical) {
    candidates.push({
      type: "battery_critical",
      severity: "critical",
      message: `Node battery critically low: ${fmtPct(reading.battery)} (threshold: ${t.batteryCritical}%). The node will go dark imminently — replace or recharge now.`,
      value: fmtPct(reading.battery),
    });
  } else if (reading.battery < t.batteryLow) {
    candidates.push({
      type: "battery_low",
      severity: "warning",
      message: `Node battery low: ${fmtPct(reading.battery)} (threshold: ${t.batteryLow}%). Schedule maintenance within the next few days.`,
      value: fmtPct(reading.battery),
    });
  }

  // ── Nutrients (NPK) — each optional (node may not have the sensor) ─────────
  if (reading.nitrogen != null && reading.nitrogen < t.nitrogenLow) {
    candidates.push({
      type: "nitrogen_low",
      severity: "warning",
      message: `Soil nitrogen depleted: ${fmtPpm(reading.nitrogen)} (threshold: ${t.nitrogenLow}). Fertilisation recommended.`,
      value: fmtPpm(reading.nitrogen),
    });
  }
  if (reading.phosphorus != null && reading.phosphorus < t.phosphorusLow) {
    candidates.push({
      type: "phosphorus_low",
      severity: "warning",
      message: `Soil phosphorus depleted: ${fmtPpm(reading.phosphorus)} (threshold: ${t.phosphorusLow}). Fertilisation recommended.`,
      value: fmtPpm(reading.phosphorus),
    });
  }
  if (reading.potassium != null && reading.potassium < t.potassiumLow) {
    candidates.push({
      type: "potassium_low",
      severity: "warning",
      message: `Soil potassium depleted: ${fmtPpm(reading.potassium)} (threshold: ${t.potassiumLow}). Fertilisation recommended.`,
      value: fmtPpm(reading.potassium),
    });
  }

  // ── Soil temperature extremes (optional) ──────────────────────────────────
  if (reading.soilTemp != null && reading.soilTemp < t.soilTempLowExtreme) {
    candidates.push({
      type: "soil_temp_extreme_low",
      severity: "critical",
      message: `Frost risk — soil temperature extreme low: ${fmtTemp(reading.soilTemp)} (threshold: ${t.soilTempLowExtreme}). Protect young trees tonight.`,
      value: fmtTemp(reading.soilTemp),
    });
  } else if (reading.soilTemp != null && reading.soilTemp > t.soilTempHighExtreme) {
    candidates.push({
      type: "soil_temp_extreme_high",
      severity: "critical",
      message: `Heat stress — soil temperature extreme high: ${fmtTemp(reading.soilTemp)} (threshold: ${t.soilTempHighExtreme}). Increase irrigation frequency.`,
      value: fmtTemp(reading.soilTemp),
    });
  }

  return candidates;
}

/**
 * Pure offline decision: which silent nodes deserve a node_offline alert.
 * The caller supplies the effective silence threshold (global default today;
 * per-farm overrides can flow through here later).
 */
export function checkOfflineNodes(
  nodes: NodeSilenceInput[],
  offlineMinutes: number
): AlertCandidate[] {
  return nodes
    .filter((n) => n.minutesSilent >= offlineMinutes)
    .map((n) => ({
      type: "node_offline",
      severity: "critical" as const,
      message: `Node "${n.name}" has not reported in over ${offlineMinutes} minutes (${Math.round(n.minutesSilent)} min silent). Check power and WiFi at its location.`,
      value: `${Math.round(n.minutesSilent)} min`,
    }));
}
