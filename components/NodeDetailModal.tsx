"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MoistureGauge } from "./MoistureGauge";
import { getNodeIrrigationLogs, getNodeTelemetry, updateNodeReadInterval, canManageInfrastructure, sendNodePing, type NodeTelemetryPoint } from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { usePolling } from "@/lib/hooks/usePolling";
import { formatDateTime } from "@/lib/format";
import type { IrrigationLog, SensorNode } from "@/lib/types";
import { useTranslations } from "next-intl";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  X,
  Battery,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Radio,
  Wifi,
  Clock,
  MapPin,
  Thermometer,
  Droplets,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  RefreshCw,
  Cpu,
  Timer,
  Loader2
} from "lucide-react";

interface NodeDetailModalProps {
  node: SensorNode | null;
  isOpen: boolean;
  onClose: () => void;
}

export function NodeDetailModal({ node, isOpen, onClose }: NodeDetailModalProps) {
  const t = useTranslations("nodeDetail");
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const [pingState, setPingState] = useState<"idle" | "sending" | "delivered" | "error">("idle");
  const [pingMessage, setPingMessage] = useState<string>("");

  const handlePing = async () => {
    if (!node) return;
    setPingState("sending");
    setPingMessage("");
    try {
      const res = await sendNodePing(node.id);
      if (res.delivered) {
        setPingState("delivered");
        setPingMessage(t("pingSent", { log: res.logId.slice(0, 8), note: res.note ?? "" }));
      } else {
        setPingState("error");
        setPingMessage(res.failureReason ?? t("pingFailed"));
      }
    } catch (err) {
      setPingState("error");
      setPingMessage(err instanceof Error ? err.message : t("pingFailed"));
    }
  };

  // Live-update while open: poll this node's telemetry + irrigation history on
  // the same POLL_INTERVAL_MS cadence used by the dashboard/zone cards. Both
  // hooks are disabled when the modal is closed so nothing runs in the
  // background after the person closes it.
  // Zone valves carry NO sensors — battery/RSSI come from their status +
  // telemetry frames. Skip the sensor telemetry poll entirely for them.
  const isZoneValve = node?.isZoneValve === true;
  const telemetryPoll = usePolling(
    () => (node?.id ? getNodeTelemetry(node.id, 24) : Promise.reject(new Error("no node"))),
    [node?.id],
    { enabled: isOpen && !!node?.id && !isZoneValve }
  );
  const logsPoll = usePolling(
    () => (node?.id ? getNodeIrrigationLogs(node.id) : Promise.reject(new Error("no node"))),
    [node?.id],
    { enabled: isOpen && !!node?.id }
  );

  if (!isOpen || !node) return null;

  // Latest polled telemetry point — drive every live stat from it so values
  // refresh in place (fall back to the passed node snapshot until first poll).
  const livePoints = telemetryPoll.data?.points ?? null;
  const latest = livePoints && livePoints.length > 0 ? livePoints[livePoints.length - 1] : null;
  const liveNode: SensorNode = latest
    ? {
        ...node,
        moisture: latest.soilMoisture ?? node.moisture,
        battery: latest.battery ?? node.battery,
        rssi: latest.rssi ?? node.rssi,
        soilTemp: latest.soilTemp ?? node.soilTemp,
        ambientTemp: latest.airTemp ?? node.ambientTemp,
        humidity: latest.airHumidity ?? node.humidity,
      }
    : node;

  const getStatusBadge = () => {
    switch (node.status) {
      case "online":
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-olive-400" />,
          label: t("statusOnline"),
          style: "bg-olive-600/20 text-olive-400 border-olive-500/40",
        };
      case "warning":
        return {
          icon: <AlertTriangle className="w-4 h-4 text-wheat-400" />,
          label: t("statusWarning"),
          style: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40",
        };
      case "offline":
      default:
        return {
          icon: <WifiOff className="w-4 h-4 text-clay-400" />,
          label: t("statusOffline"),
          style: "bg-clay-600/20 text-clay-400 border-clay-500/40",
        };
    }
  };

  const statusBadge = getStatusBadge();

  const getBatteryIcon = (pct: number | null) => {
    if (pct === null) return <BatteryWarning className="w-5 h-5 text-parchment/30" />;
    if (pct > 75) return <Battery className="w-5 h-5 text-olive-400" />;
    if (pct > 40) return <BatteryMedium className="w-5 h-5 text-olive-400" />;
    if (pct > 20) return <BatteryLow className="w-5 h-5 text-wheat-400" />;
    return <BatteryWarning className="w-5 h-5 text-clay-400" />;
  };

  // RSSI Signal Bars Calculation (-90 / -80 / -70 / -60 dBm)
  const getSignalStrength = (rssi: number | null) => {
    if (rssi === null) return { bars: 0, label: t("noReadingYet"), color: "text-parchment/40", value: "—" };
    if (rssi >= -60) return { bars: 4, label: t("signalExcellent", { value: "-60dBm" }), color: "text-olive-400", value: `${rssi} dBm` };
    if (rssi >= -70) return { bars: 3, label: t("signalGood", { value: "-70dBm" }), color: "text-olive-400", value: `${rssi} dBm` };
    if (rssi >= -80) return { bars: 2, label: t("signalFair", { value: "-80dBm" }), color: "text-wheat-400", value: `${rssi} dBm` };
    if (rssi >= -90) return { bars: 1, label: t("signalWeak", { value: "-90dBm" }), color: "text-clay-400", value: `${rssi} dBm` };
    return { bars: 0, label: t("noSignal"), color: "text-clay-400", value: `${rssi} dBm` };
  };

  const signal = getSignalStrength(liveNode.rssi);
  const battery = liveNode.battery;
  const caps = node.sensorCapabilities ?? ["soilMoisture"];

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      onClick={onClose}
    >
      <div
        className="flex flex-col overflow-hidden bg-soil-900 w-full h-full sm:rounded-2xl sm:border-2 sm:border-soil-700 sm:shadow-2xl md:w-4/5 md:h-4/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned header — title + close + status badge never scroll away */}
        <div className="flex-none flex flex-col gap-4 border-b border-soil-800 bg-soil-900 px-6 pt-5 pb-4">
            <div className="flex items-start justify-between gap-4 border-b border-soil-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-soil-800 border border-soil-700 flex items-center justify-center text-olive-400 shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="drawer-title" className="text-xl font-display font-bold text-parchment">
                    {node.name}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs text-olive-400 font-bold bg-soil-950 px-2 py-0.5 rounded border border-soil-800">
                      {node.id}
                    </span>
                    <span className="text-xs font-sans text-parchment/60">
                      {node.zoneName || node.zoneId}
                    </span>
                  </div>
                </div>
              </div>

              {/* Close Button (Min 48px touch target) */}
              <button
                type="button"
                onClick={onClose}
                aria-label={t("closeNodeDetails")}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg text-parchment/60 hover:text-parchment hover:bg-soil-800 border border-transparent hover:border-soil-700 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Status Multi-modal Badge */}
            <div
              className={`p-3 rounded-xl border flex items-center gap-3 font-mono text-xs font-bold ${statusBadge.style}`}
            >
{statusBadge.icon}
              <span>{statusBadge.label}</span>
            </div>
        </div>

        {/* Scrollable body — flex-1 + min-h-0; header/footer stay pinned */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6 bg-soil-900">
          {/* Telemetry Overview */}
          {/* Part 13 ext: capability tags — what this node actually measures.
              A zone valve has no sensor capabilities, so the row is omitted. */}
          {!isZoneValve && (
          <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-wider text-parchment/50 mr-1">{t("sensors")}:</span>
              {(node.sensorCapabilities ?? ["soilMoisture"]).map((cap) => (
                <span key={cap} className="px-1.5 py-px rounded text-[10px] font-mono bg-soil-800 text-parchment/70 border border-soil-700">
                  {cap}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-5">
            {/* Primary Moisture Block — zone valves report no soil moisture */}
            {!isZoneValve && (
            <div className="bg-soil-950/80 border border-soil-700 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-mono uppercase tracking-wider text-parchment/60">
                  {t("soilMoistureTitle")}
                </span>
                <div className="text-2xl font-mono font-bold text-parchment">
                  {liveNode.moisture !== null && liveNode.moisture !== undefined ? (
                    <>
                      {liveNode.moisture}
                      <span className="text-sm text-parchment/60 ml-1">%</span>
                    </>
                  ) : (
                    <span className="text-clay-400 text-base font-bold">{t("noReading")}</span>
                  )}
                </div>
                <p className="text-xs text-parchment/60 font-sans">
                  {t("probeTip")}
                </p>
              </div>

              <div className="shrink-0">
                <MoistureGauge value={liveNode.moisture} target={50} size="sm" />
              </div>
            </div>
            )}

            {/* Hardware Vitals Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Battery */}
              <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-parchment/60 uppercase">{t("battery")}</span>
                  {getBatteryIcon(liveNode.battery)}
                </div>
                <div className="text-xl font-mono font-bold text-parchment">
                  {battery !== null ? (
                    <>
                      {battery}
                      <span className="text-sm text-parchment/60 ml-0.5">%</span>
                    </>
                  ) : (
                    <span className="text-base font-bold text-parchment/40">—</span>
                  )}
                </div>
                <div className="w-full bg-soil-950 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      battery === null
                        ? "bg-soil-700"
                        : battery > 50
                        ? "bg-olive-500"
                        : battery > 20
                        ? "bg-wheat-500"
                        : "bg-clay-500"
                    }`}
                    style={{ width: `${battery ?? 0}%` }}
                  />
                </div>
              </div>

              {/* RSSI Signal */}
              <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-parchment/60 uppercase">{t("signalRssi")}</span>
                  <Radio className={`w-4 h-4 ${signal.color}`} />
                </div>
                <div className="text-xl font-mono font-bold text-parchment">
                  {liveNode.rssi} <span className="text-xs text-parchment/60 font-normal">dBm</span>
                </div>
                {/* 4-bar indicator */}
                <div className="flex items-end gap-1 h-3 pt-0.5">
                  {[1, 2, 3, 4].map((barIndex) => (
                    <div
                      key={barIndex}
                      className={`w-2 rounded-t-sm transition-all ${
                        barIndex <= signal.bars
                          ? barIndex <= 2
                            ? "bg-wheat-400"
                            : "bg-olive-400"
                          : "bg-soil-700"
                      }`}
                      style={{ height: `${barIndex * 25}%` }}
                    />
                  ))}
                </div>
              </div>

              {/* Soil Temperature — only if the node actually has this sensor */}
              {caps.includes("soilTemp") && (
              <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-mono text-parchment/60 uppercase">
                  <Thermometer className="w-3.5 h-3.5 text-wheat-400" />
                  <span>{t("soilTemp")}</span>
                </div>
                <div className="text-lg font-mono font-bold text-parchment">
                  {liveNode.soilTemp !== undefined && liveNode.soilTemp !== null
                    ? `${liveNode.soilTemp} °C`
                    : "—"}
                </div>
              </div>
              )}

              {/* Ambient (Air) Temp & Humidity — gated by capabilities */}
              {(caps.includes("airTemp") || caps.includes("airHumidity")) && (
              <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-mono text-parchment/60 uppercase">
                  <Droplets className="w-3.5 h-3.5 text-olive-400" />
                  <span>{t("airHum")}</span>
                </div>
                <div className="text-lg font-mono font-bold text-parchment flex items-baseline gap-1">
                  <span>
                    {liveNode.ambientTemp !== undefined && liveNode.ambientTemp !== null
                      ? `${liveNode.ambientTemp}°C`
                      : "—"}
                  </span>
                  <span className="text-xs text-parchment/60 font-normal">
                    /{" "}
                    {liveNode.humidity !== undefined && liveNode.humidity !== null
                      ? `${liveNode.humidity}%`
                      : "—"}
                  </span>
                </div>
              </div>
              )}
            </div>

{/* 24h telemetry trend — same charts as the node dashboard. Omitted for
              zone valves: they report no soil/nutrient/climate telemetry. */}
            {!isZoneValve && (
            <TelemetryCharts
              node={liveNode}
              points={livePoints}
              loading={telemetryPoll.loading}
              error={telemetryPoll.error ? (telemetryPoll.error as Error).message : null}
            />
            )}

            {/* Irrigation history — THIS node's runs only */}
            <IrrigationHistory
              node={node}
              logs={logsPoll.data ?? null}
              loading={logsPoll.loading}
              error={logsPoll.error ? (logsPoll.error as Error).message : null}
            />

            {/* Part 11: Read interval configuration (technician+ only). Sensor
                cadence is meaningless for a valve with no sensors. */}
            {!isZoneValve && <ReadIntervalSection node={node} />}

            {/* Part 13: dedicated threshold page (single UI, no compact duplicate).
                Zone valves have no sensor data to threshold. */}
            {!isZoneValve && (
            <Link
              href={`/nodes/${node.id}/settings`}
              onClick={onClose}
              className="block bg-soil-950/60 border border-soil-800 hover:border-olive-500/50 rounded-xl p-4 transition-colors group"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-parchment/70 uppercase flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-wheat-400" /> {t("alertThresholds")}
                </span>
                <span className="text-xs font-mono text-olive-400 group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
              <p className="text-[10px] text-parchment/40 font-sans mt-1 leading-relaxed">
                {t("thresholdsSub")}
              </p>
            </Link>
            )}

            {/* Network & Spatial Details */}
            <div className="bg-soil-950/60 border border-soil-800 rounded-xl p-4 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center text-parchment/70">
                <span className="flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5 text-olive-400" /> {t("protocol")}
                </span>
                <span className="font-bold text-parchment uppercase">{t("frequency", { band: node.commMethod })}</span>
              </div>

              <div className="flex justify-between items-center text-parchment/70">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-parchment/50" /> {t("lastHeartbeat")}
                </span>
                <span className="font-bold text-parchment">{node.lastSeen}</span>
              </div>

              <div className="flex justify-between items-center text-parchment/70">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-parchment/50" /> {t("fieldCoordinates")}
                </span>
                <span className="font-bold text-parchment font-mono">
                  {typeof node.lat === "number" && typeof node.lon === "number"
                    ? `${Number(node.lat).toFixed(5)}, ${Number(node.lon).toFixed(5)}`
                    : t("coordsNotSet")}
                </span>
              </div>

              {/* Part 13 ext: install metadata */}
              <div className="flex justify-between items-center text-parchment/70">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-parchment/50" /> {t("installed")}
                </span>
                <span className="font-bold text-parchment">
                  {node.installedAt ? new Date(node.installedAt).toLocaleDateString() : "—"}
                </span>
              </div>
              {node.notes && (
                <div className="pt-2 border-t border-soil-800/60 text-[11px] font-sans text-parchment/70 italic leading-relaxed">
                  {node.notes}
                </div>
              )}
            </div>
          </div>

</div>

        {/* Pinned footer — diagnostic action stays reachable */}
        <div className="flex-none px-6 py-4 border-t border-soil-800 bg-soil-900 space-y-2">
            <button
              type="button"
              onClick={handlePing}
              disabled={pingState === "sending"}
              className="w-full min-h-[48px] rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pingState === "sending" ? (
                <Loader2 className="w-4 h-4 text-olive-400 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 text-olive-400" />
              )}
              <span>{pingState === "sending" ? t("pingSending") : t("sendPing")}</span>
            </button>
            {pingMessage && (
              <p className={`font-mono text-xs leading-relaxed ${pingState === "error" ? "text-clay-400" : "text-olive-400"}`}>
                {pingMessage}
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

// ── Part 11: per-node read interval (technician+ only) ─────────────────────

function ReadIntervalSection({ node }: { node: SensorNode }) {
  const { user } = useAuth();
  const t = useTranslations("readInterval");
  const canEdit = canManageInfrastructure(user);

  const [value, setValue] = useState<string>(node.readIntervalMs ? String(node.readIntervalMs) : "");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Reset local state when a different node is opened.
  useEffect(() => {
    setValue(node.readIntervalMs ? String(node.readIntervalMs) : "");
    setResult(null);
  }, [node.id, node.readIntervalMs]);

  if (!canEdit) {
    return (
      <div className="bg-soil-950/60 border border-soil-800 rounded-xl p-4 flex items-center justify-between text-xs font-mono">
        <span className="flex items-center gap-1.5 text-parchment/60">
          <Timer className="w-3.5 h-3.5 text-parchment/50" /> {t("label")}
        </span>
        <span className="text-parchment">
          {node.readIntervalMs ? `${(node.readIntervalMs / 1000).toFixed(0)}s` : t("farmDefault")}
        </span>
      </div>
    );
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setResult(null);
    try {
      const parsed = value.trim() === "" ? null : Number(value);
      const updated = await updateNodeReadInterval(node.id, parsed);
      setResult({
        ok: updated.configDelivered,
        text: updated.configDelivered
          ? t("savedPushed", { topic: updated.configTopic.split("/").slice(-2).join("/") })
          : t("notDelivered", { reason: updated.failureReason ?? "broker unreachable" }),
      });
      setTimeout(() => setResult(null), 8000);
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-soil-950/60 border border-soil-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-mono text-parchment/60 uppercase">
        <Timer className="w-3.5 h-3.5 text-olive-400" />
        <span>{t("labelEdit")}</span>
      </div>
      <div className="flex items-end gap-2">
        <label className="flex-1 space-y-1">
          <span className="sr-only">{t("srOnly")}</span>
          <input
            type="number"
            min={1000}
            step={1000}
            placeholder={t("placeholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-lg bg-soil-900 border border-soil-700 text-parchment font-mono text-sm focus:outline-none focus:border-olive-400"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          title={t("pushTitle")}
          className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 active:bg-soil-600 text-olive-400 border border-soil-600 font-mono text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          {t("push")}
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={`text-[11px] font-mono flex items-start gap-1.5 ${
            result.ok ? "text-olive-400" : "text-wheat-400"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          )}
          {result.text}
        </p>
      )}
<p className="text-[10px] text-parchment/40 font-sans leading-relaxed">
        {t("hint")}
      </p>
    </div>
  );
}

// ── 24h telemetry trend charts (same shape as the node dashboard) ─────────────

function TelemetryCharts({
  node,
  points,
  loading,
  error,
}: {
  node: SensorNode;
  points: NodeTelemetryPoint[] | null;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("telemetryCharts");
  if (error) {
    return (
      <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-[11px] font-mono flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>{error}</span>
      </div>
    );
  }

  if (loading || points === null) {
    return (
      <div className="space-y-3">
        <div className="h-24 rounded-xl bg-soil-900 border border-soil-700 animate-pulse motion-reduce:animate-none" />
        <div className="h-24 rounded-xl bg-soil-900 border border-soil-700 animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="bg-soil-950/60 border-2 border-dashed border-soil-700 rounded-xl p-6 text-center space-y-1.5">
        <AlertTriangle className="w-6 h-6 text-parchment/30 mx-auto" />
        <p className="font-mono text-xs text-parchment/60">{t("noTelemetry24h")}</p>
        <p className="text-[11px] font-sans text-parchment/40">{t("chartsAfterReading")}</p>
      </div>
    );
  }

  const caps = node.sensorCapabilities ?? ["soilMoisture"];
  const last = points[points.length - 1];

  const moistureData = points.map((p) => ({
    time: new Date(p.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    moisture: p.soilMoisture,
  }));
  const nutrientData = points.map((p) => ({
    time: new Date(p.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    nitrogen: p.nitrogen,
    phosphorus: p.phosphorus,
    potassium: p.potassium,
  }));
  const climateData = points.map((p) => ({
    time: new Date(p.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    soilTemp: p.soilTemp,
    airTemp: p.airTemp,
    humidity: p.airHumidity,
  }));

  const hasNutrients = caps.some((c) => c === "nitrogen" || c === "phosphorus" || c === "potassium");
  const hasClimate = caps.some((c) => c === "soilTemp" || c === "airTemp" || c === "airHumidity");

  const nutrientSeries: { key: string; color: string; label: string }[] = [];
  {
    const defs: Record<string, { color: string; label: string }> = {
      nitrogen: { color: "#8BAE6E", label: "N" },
      phosphorus: { color: "#E4C173", label: "P" },
      potassium: { color: "#C99FC9", label: "K" },
    };
    for (const k of ["nitrogen", "phosphorus", "potassium"] as const) {
      if (caps.includes(k)) nutrientSeries.push({ key: k, ...defs[k] });
    }
  }

  const climateSeries = (
    [
      caps.includes("soilTemp") && { key: "soilTemp", color: "#E0714A" },
      caps.includes("airTemp") && { key: "airTemp", color: "#C99FC9" },
      caps.includes("airHumidity") && { key: "humidity", color: "#7FA8C9", yAxisId: "right" },
    ].filter(Boolean) as { key: string; color: string; yAxisId?: string }[]
  );

  return (
    <div className="space-y-3">
      {hasNutrients && (
        <div className="grid grid-cols-3 gap-3">
          {caps.includes("nitrogen") && (
            <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5">
              <div className="text-[10px] font-mono uppercase text-parchment/60">{t("nitrogen")}</div>
              <div className="text-xl font-mono font-bold text-olive-400 mt-1">
                {last?.nitrogen ?? <span className="text-parchment/40">—</span>}
                <span className="text-[10px] text-parchment/60 font-normal"> ppm</span>
              </div>
            </div>
          )}
          {caps.includes("phosphorus") && (
            <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5">
              <div className="text-[10px] font-mono uppercase text-parchment/60">{t("phosphorus")}</div>
              <div className="text-xl font-mono font-bold text-wheat-400 mt-1">
                {last?.phosphorus ?? <span className="text-parchment/40">—</span>}
                <span className="text-[10px] text-parchment/60 font-normal"> ppm</span>
              </div>
            </div>
          )}
          {caps.includes("potassium") && (
            <div className="bg-soil-800/80 border border-soil-700 rounded-xl p-3.5">
              <div className="text-[10px] font-mono uppercase text-parchment/60">{t("potassium")}</div>
              <div className="text-xl font-mono font-bold text-[#C99FC9] mt-1">
                {last?.potassium ?? <span className="text-parchment/40">—</span>}
                <span className="text-[10px] text-parchment/60 font-normal"> ppm</span>
              </div>
            </div>
          )}
        </div>
      )}

      {caps.includes("soilMoisture") && (
        <TrendChart
          title={t("soilMoisture")}
          data={moistureData}
          series={[{ key: "moisture", color: "#8BAE6E" }]}
          yUnit="%"
          emptyLabel={t("noMoisture")}
        />
      )}

      {hasNutrients && (
        <TrendChart
          title={t("nutrientsPpm")}
          data={nutrientData}
          series={nutrientSeries}
          yUnit="ppm"
          emptyLabel={t("noNutrients")}
        />
      )}

      {hasClimate && (
        <TrendChart
          title={t("tempHumidity")}
          data={climateData}
          series={climateSeries}
          emptyLabel={t("noClimate")}
        />
      )}
    </div>
  );
}

function TrendChart({
  title,
  data,
  series,
  yUnit,
  emptyLabel,
}: {
  title: string;
  data: Record<string, unknown>[];
  series: { key: string; color: string; label?: string; yAxisId?: string }[];
  yUnit?: string;
  emptyLabel: string;
}) {
  const t = useTranslations("telemetryCharts");
  if (data.length === 0) {
    return (
      <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 text-center text-[11px] font-mono text-parchment/50">
        {emptyLabel}
      </div>
    );
  }
  const palette = ["#8BAE6E", "#E4C173", "#E0714A"];
  const hasRightAxis = series.some((s) => s.yAxisId === "right");
  const prettyKey = (key: string) =>
    ({ moisture: t("moisture"), nitrogen: "N", phosphorus: "P", potassium: "K", soilTemp: t("soilTemp"), airTemp: t("airTemp"), humidity: t("humidity") })[key] ?? key;
  return (
    <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-3.5 space-y-2">
      <div className="text-[11px] font-mono uppercase tracking-wider text-parchment/60">{title}</div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: hasRightAxis ? 0 : 8, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#332C23" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: "#A89E90", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#332C23" }} />
            <YAxis yAxisId="left" tick={{ fill: "#A89E90", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#332C23" }} unit={yUnit} domain={["auto", "auto"]} />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#A89E90", fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: "#332C23" }}
                unit="%"
                domain={["auto", "auto"]}
              />
            )}
            <Tooltip
              contentStyle={{ background: "#14120FEE", border: "2px solid #332C23", borderRadius: 12 }}
              labelStyle={{ color: "#F0EBE0" }}
              formatter={(value, name) => [value, prettyKey(String(name))]}
            />
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color ?? palette[i % palette.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
                yAxisId={s.yAxisId ?? "left"}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[9px] font-mono text-parchment/60 uppercase">
            <span className="w-2 h-2 rounded-full" style={{ background: s.color ?? palette[i % palette.length] }} />
            {s.label ?? prettyKey(s.key)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Irrigation history — this node's runs only ───────────────────────────────

function IrrigationHistory({
  node,
  logs,
  loading,
  error,
}: {
  node: SensorNode;
  logs: IrrigationLog[] | null;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("irrigationHistory");

  const durationMin = (log: IrrigationLog): string => {
    if (log.skipped || !log.endedAt) return "—";
    const mins = Math.round(
      (new Date(log.endedAt).getTime() - new Date(log.startedAt).getTime()) / 60000
    );
    return `${Math.max(0, mins)} ${t("minUnit")}`;
  };

  const triggerLabel = (log: IrrigationLog): string =>
    log.triggeredBy === "schedule" ? t("schedule") : t("manual");

  const waterLabel = (log: IrrigationLog): string => {
    if (log.skipped) return "—";
    if (log.waterUsedL == null || log.waterUsedL === 0) return t("unmetered");
    return `${log.waterUsedL.toLocaleString()} L`;
  };

  return (
    <section aria-label={t("historyAria", { name: node.name })}>
      <div className="flex items-center justify-between border-b border-soil-800 pb-2 mb-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-parchment/70">
          {t("title")}
        </h3>
        {logs !== null && logs.length > 0 && (
          <span className="text-[10px] font-mono text-parchment/40">
            {t("runs", { count: logs.length })}
          </span>
        )}
      </div>

      {error ? (
        <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-[11px] font-mono flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      ) : loading || logs === null ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-soil-900 border border-soil-700 animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-soil-950/60 border-2 border-dashed border-soil-700 rounded-xl p-6 text-center space-y-1.5">
          <Droplets className="w-6 h-6 text-parchment/30 mx-auto" />
          <p className="font-mono text-xs text-parchment/60">{t("noHistory")}</p>
          <p className="text-[11px] font-sans text-parchment/40">
            {t("noHistorySub")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-soil-800 border border-soil-700 rounded-xl overflow-hidden bg-soil-950/40">
          {logs.slice(0, 10).map((log) => (
            <li key={log.id} className="p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${
                      log.skipped
                        ? "bg-wheat-600/15 text-wheat-400 border-wheat-500/30"
                        : "bg-olive-600/15 text-olive-400 border-olive-500/30"
                    }`}
                  >
                    {log.skipped ? t("skipped") : log.endedAt ? t("completed") : t("running")}
                  </span>
                  <span className="text-[11px] font-mono text-parchment/70 truncate">
                    {formatDateTime(log.startedAt)}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-parchment/40 uppercase shrink-0">
                  {triggerLabel(log)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-parchment/60 pl-1">
                <span>{t("duration", { value: durationMin(log) })}</span>
                <span>{t("water", { value: waterLabel(log) })}</span>
              </div>
              {log.skipped && log.skipReason && (
                <p className="text-[11px] font-sans text-wheat-400/90 leading-snug pl-1">
                  {log.skipReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
