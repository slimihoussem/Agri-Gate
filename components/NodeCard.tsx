"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Droplet,
  BatteryWarning,
  Battery,
  BatteryMedium,
  BatteryLow,
  Radio,
  Play,
  Square,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { NodeIrrigationStatus, SensorNode } from "@/lib/types";
import {
  getNodeIrrigationStatus,
  getNodeSettings,
  startNodeIrrigation,
  stopNodeIrrigation,
  LastRunningValveBlockedError,
} from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { timeAgo } from "@/lib/format";
import { useTranslations } from "next-intl";

function batteryMeta(b: number | null): { icon: typeof Battery; cls: string } {
  if (b === null) return { icon: BatteryWarning, cls: "text-parchment/30" };
  if (b > 75) return { icon: Battery, cls: "text-olive-400" };
  if (b > 40) return { icon: BatteryMedium, cls: "text-olive-400" };
  if (b > 20) return { icon: BatteryLow, cls: "text-wheat-400" };
  return { icon: BatteryWarning, cls: "text-clay-400" };
}

export function NodeCard({
  node,
  canIrrigate,
  onOpenDrawer,
  onOpenSchedule,
}: {
  node: SensorNode;
  /** True when the viewer holds irrigation.manage (farmer/technician/admin). */
  canIrrigate: boolean;
  onOpenDrawer: () => void;
  onOpenSchedule: () => void;
}) {
  const t = useTranslations("nodeCard");
  const statusDot =
    node.status === "online"
      ? "bg-olive-400"
      : node.status === "warning"
        ? "bg-wheat-400"
        : "bg-clay-400";
  const statusBadge =
    node.status === "online"
      ? "bg-olive-600/20 text-olive-400 border-olive-500/40"
      : node.status === "warning"
        ? "bg-wheat-600/20 text-wheat-400 border-wheat-500/40"
        : "bg-clay-600/20 text-clay-400 border-clay-500/40";
  const { icon: BatIcon, cls: batCls } = batteryMeta(node.battery);

  const caps = node.sensorCapabilities ?? [];
  const hasSoil = node.moisture != null || caps.includes("soilMoisture");
  const hasBattery = node.battery != null || caps.includes("battery");
  const hasSignal = node.rssi != null || caps.includes("signal");

  const columns: React.ReactNode[] = [];
  if (hasSoil) {
    columns.push(
      <div key="soil" className="flex items-center gap-1.5 text-parchment/70">
        <Droplet className="w-3.5 h-3.5 text-olive-400" />
        <span className="text-parchment/50">{t("soil")}</span>
        <strong className={`ml-auto ${node.moisture != null ? "text-parchment" : "text-parchment/40"}`}>
          {node.moisture != null ? `${Math.round(node.moisture)}%` : "—"}
        </strong>
      </div>
    );
  }
  if (hasBattery) {
    columns.push(
      <div key="batt" className={`flex items-center gap-1.5 text-parchment/70 ${batCls}`}>
        <BatIcon className="w-3.5 h-3.5" />
        <span className="text-parchment/50">{t("batt")}</span>
        <strong className={`ml-auto ${node.battery != null ? "text-parchment" : "text-parchment/40"}`}>
          {node.battery != null ? `${Math.round(node.battery)}%` : "—"}
        </strong>
      </div>
    );
  }
  if (hasSignal) {
    columns.push(
      <div key="sig" className="flex items-center gap-1.5 text-parchment/70">
        <Radio className="w-3.5 h-3.5 text-parchment/50" />
        <span className="text-parchment/50">{t("sig")}</span>
        <strong className={`ml-auto ${node.rssi != null ? "text-parchment" : "text-parchment/40"}`}>
          {node.rssi != null ? `${node.rssi} dBm` : "—"}
        </strong>
      </div>
    );
  }

  return (
    <article
      data-node-id={node.id}
      onClick={onOpenDrawer}
      role="button"
      tabIndex={0}
      aria-label={t("openNodeDetails", { name: node.name })}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpenDrawer();
      }}
      className="group cursor-pointer bg-soil-900 border-2 border-soil-700 hover:border-olive-500/60 rounded-xl p-4 shadow-lg transition-all flex flex-col gap-3"
    >
      {/* Header row */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot}`} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-parchment truncate">{node.name}</div>
          <div className="text-[11px] font-mono text-parchment/50 truncate">{node.id}</div>
        </div>
      </div>

      {/* Telemetry strip — only capabilities this node actually has */}
      {columns.length > 0 ? (
        <div className={`grid ${columns.length === 3 ? "grid-cols-3" : columns.length === 2 ? "grid-cols-2" : "grid-cols-1"} gap-2 bg-soil-950/70 border border-soil-800 rounded-lg p-2.5 font-mono text-xs`}>
          {columns}
        </div>
      ) : (
        <div className="bg-soil-950/70 border border-soil-800 rounded-lg p-2.5 font-mono text-xs text-parchment/40">
          {t("noSensorData")}
        </div>
      )}

      {/* Last seen */}
      <div className="text-[11px] font-mono text-parchment/40 flex items-center justify-between">
        <span className={`px-2 py-0.5 rounded border ${statusBadge}`}>{node.status}</span>
        <span>{t("seen", { time: timeAgo(node.lastSeen) })}</span>
      </div>

      {/* Control section — identical skeleton on every card; server rejects nodes without valves */}
      <div onClick={(e) => e.stopPropagation()} className="space-y-2 border-t border-soil-800 pt-3">
        <ActuatorControls nodeId={node.id} nodeName={node.name} canIrrigate={canIrrigate} onOpenSchedule={onOpenSchedule} />
      </div>
    </article>
  );
}

// ── Actuator live controls (compact) ────────────────────────────────────────
// Public so a zone's Zone Valve card (Part 19) can reuse identical
// open/close/schedules mechanics without any telemetry section.

export function ActuatorControls({
  nodeId,
  nodeName,
  canIrrigate,
  onOpenSchedule,
}: {
  nodeId: string;
  nodeName: string;
  canIrrigate: boolean;
  onOpenSchedule: () => void;
}) {
  const tAct = useTranslations("actuator");
  const tCommon = useTranslations("common");
  const [status, setStatus] = useState<NodeIrrigationStatus | null>(null);
  const [maxRunningMinutes, setMaxRunningMinutes] = useState<number | null>(null);
  const [pending, setPending] = useState<"open" | "stop" | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [blocked, setBlocked] = useState<LastRunningValveBlockedError | null>(null);
  const [forceBusy, setForceBusy] = useState(false);

  const { user } = useAuth();
  const canForceClose = user?.role === "technician" || user?.role === "admin";

  const reload = useCallback(async (): Promise<void> => {
    try {
      setStatus(await getNodeIrrigationStatus(nodeId));
    } catch {
      /* keep last known state */
    }
  }, [nodeId]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 20_000);
    return () => clearInterval(timer);
  }, [reload]);

  // Effective long-running threshold so the Running pill can warn before the
  // backend does (default 240; farm/node overrides included).
  useEffect(() => {
    getNodeSettings(nodeId)
      .then((eff) => setMaxRunningMinutes(eff.values.irrigationMaxRunningMinutes ?? null))
      .catch(() => setMaxRunningMinutes(null));
  }, [nodeId]);

  const isRunning = status?.isRunning === true;
  const startedAt = isRunning && status?.currentLog?.startedAt ? new Date(status.currentLog.startedAt).getTime() : null;
  const elapsedMin =
    startedAt !== null && maxRunningMinutes !== null
      ? (Date.now() - startedAt) / 60_000
      : 0;
  const runningLong = isRunning && maxRunningMinutes !== null && elapsedMin >= maxRunningMinutes;

  const execute = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    try {
      const res =
        pending === "open"
          ? await startNodeIrrigation(nodeId)
          : await stopNodeIrrigation(nodeId);
      setBanner(
        res.delivered
          ? { ok: true, text: pending === "open" ? tAct("valveOpenBanner") : tAct("valveClosedBanner") }
          : { ok: false, text: res.failureReason ?? tAct("cmdNotDelivered") }
      );
      await reload();
    } catch (err) {
      if (err instanceof LastRunningValveBlockedError) {
        setBlocked(err);
      } else {
        setBanner({ ok: false, text: (err as Error).message });
      }
    } finally {
      setBusy(false);
      setPending(null);
      setTimeout(() => setBanner(null), 6000);
    }
  };

  // Real second network call: re-POST the stop with force=true (the backend
  // re-enforces role + audits force_close_last_valve / force_close_last_zone_valve).
  const forceClose = async (): Promise<void> => {
    setForceBusy(true);
    try {
      const res = await stopNodeIrrigation(nodeId, { force: true });
      setBlocked(null);
      setBanner(
        res.delivered
          ? { ok: true, text: tAct("valveClosedBanner") }
          : { ok: false, text: res.failureReason ?? tAct("cmdNotDelivered") }
      );
      await reload();
    } catch (err) {
      setBlocked(null);
      setBanner({ ok: false, text: (err as Error).message });
    } finally {
      setForceBusy(false);
      setTimeout(() => setBanner(null), 6000);
    }
  };

  return (
    <div className="relative space-y-2.5">
      {/* Control row — Open (or Running pill + Close Now) only; the duration is chosen in the confirm dialog at start time */}
      <div className="flex items-center justify-between gap-2 min-h-[48px]">
        {isRunning && (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-soil-950 text-[11px] font-mono font-bold ${
              runningLong
                ? "bg-wheat-500 border-wheat-400"
                : "bg-olive-500 border-olive-400"
            }`}
            title={runningLong ? tAct("runningLongTitle", { minutes: Math.round(maxRunningMinutes ?? 0) }) : tAct("valveOpenTitle")}
          >
            <span className={`w-2 h-2 rounded-full bg-soil-950 animate-pulse motion-reduce:animate-none ${runningLong ? "bg-clay-500" : ""}`} />
            {runningLong ? tAct("runningLong") : tAct("running")}
          </span>
        )}

        {canIrrigate && (
          <button
            type="button"
            onClick={() => setPending(isRunning ? "stop" : "open")}
            className={`min-h-[44px] rounded-lg font-mono font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-md ${
              isRunning
                ? "w-[120px] shrink-0 bg-clay-500 hover:bg-clay-600 text-white"
                : "flex-1 bg-olive-500 hover:bg-olive-600 text-soil-950"
            }`}
          >
            {isRunning ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" /> {tAct("closeNow")}
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> {tAct("open")}
              </>
            )}
          </button>
        )}
      </div>

      {/* Schedules — full width, fixed position relative to the control row */}
      <button
        type="button"
        onClick={onOpenSchedule}
        className="w-full min-h-[44px] rounded-lg border border-soil-600 hover:border-wheat-500 text-wheat-400 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
      >
        <CalendarClock className="w-4 h-4" /> {tAct("schedules")}
      </button>

      {/* Feedback banner — overlays, never shifts the skeleton */}
      {banner && (
        <div
          role="status"
          className={`absolute top-full left-0 right-0 mt-1 z-20 p-2 rounded-lg text-[11px] font-mono flex items-center gap-1.5 ${
            banner.ok
              ? "bg-olive-600/15 border border-olive-500/40 text-olive-400"
              : "bg-clay-500/10 border border-clay-500/40 text-clay-400"
          }`}
        >
          {banner.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          isOpen
          title={pending === "open" ? tAct("confirmOpen") : tAct("confirmClose")}
          message={
            pending === "open"
              ? tAct("confirmOpenMsg", { name: nodeName })
              : tAct("confirmCloseMsg", { name: nodeName })
          }
          confirmText={busy ? tCommon("sending") : pending === "open" ? tAct("confirmOpenBtn") : tAct("close")}
          cancelText={tCommon("cancel")}
          variant={pending === "open" ? "primary" : "danger"}
          onConfirm={execute}
          onCancel={() => setPending(null)}
        />
      )}

      {blocked && (
        <ConfirmDialog
          isOpen
          title={blocked.isFarmLevelRule ? tAct("zoneValveCloseBlocked") : tAct("valveCloseBlocked")}
          message={blocked.message}
          confirmText={forceBusy ? tAct("closing") : tAct("forceClose")}
          cancelText={canForceClose ? tCommon("cancel") : tCommon("ok")}
          variant="danger"
          hideConfirm={!canForceClose}
          onConfirm={() => void forceClose()}
          onCancel={() => setBlocked(null)}
        >
          {canForceClose ? (
            <p className="text-xs font-mono text-parchment/60 leading-relaxed">
              {blocked.isFarmLevelRule
                ? tAct("forceZoneRule")
                : tAct("forceLastValve")}
            </p>
          ) : (
            <p className="text-xs font-mono text-parchment/60 leading-relaxed">
              {tAct("contactTech")}
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}