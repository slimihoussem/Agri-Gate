"use client";

import React from "react";
import Link from "next/link";
import { Zone } from "@/lib/types";
import { MoistureGauge } from "./MoistureGauge";
import { timeAgo } from "@/lib/format";
import { ZoneValveControlBadge } from "./ZoneValveControlBadge";
import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertOctagon, 
  Droplets, 
  Cpu, 
  Clock, 
  ChevronRight, 
  WifiOff 
} from "lucide-react";
import { useTranslations } from "next-intl";

interface ZoneCardProps {
  zone: Zone;
  /**
   * Optional quick-action button. When provided its click does NOT trigger
   * navigation; the rest of the card always links to the zone's node grid.
   */
  onQuickWater?: (zone: Zone) => void;
}

export function ZoneCard({ zone, onQuickWater }: ZoneCardProps) {
  const t = useTranslations("zoneCard");
  const isDisconnected = zone.activeNodeCount === 0 || zone.moisture === null;

  // Multi-modal status indicator (Color + Icon + Text together)
  const getStatusBadge = () => {
    if (isDisconnected) {
      return {
        icon: <WifiOff className="w-3.5 h-3.5" />,
        label: t("offline"),
        color: "bg-clay-600/20 text-clay-400 border-clay-500/40",
      };
    }
    switch (zone.status) {
      case "ok":
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
          label: t("optimal"),
          color: "bg-olive-600/20 text-olive-400 border-olive-500/40",
        };
      case "warning":
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
          label: t("warning"),
          color: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40",
        };
      case "critical":
        return {
          icon: <AlertOctagon className="w-3.5 h-3.5" />,
          label: t("critical"),
          color: "bg-clay-600/20 text-clay-400 border-clay-500/40",
        };
      case "disconnected":
      default:
        return {
          icon: <WifiOff className="w-3.5 h-3.5" />,
          label: t("noData"),
          color: "bg-clay-600/20 text-clay-400 border-clay-500/40",
        };
    }
  };

  const statusBadge = getStatusBadge();

  // NPK Normal Ranges
  // N: 150-300 ppm
  // P: 30-80 ppm
  // K: 100-250 ppm
  const getNPKStatus = (value: number, min: number, max: number) => {
    if (value >= min && value <= max) {
      return { status: "normal", color: "bg-olive-500", text: "text-olive-400", label: t("normal") };
    }
    if (value < min) {
      return { status: "low", color: "bg-wheat-500", text: "text-wheat-400", label: t("low") };
    }
    return { status: "high", color: "bg-clay-500", text: "text-clay-400", label: t("high") };
  };

  // NPK is null on zones with no active sensors — only grade real values.
  const nStatus = zone.nitrogen === null ? null : getNPKStatus(zone.nitrogen, 150, 300);
  const pStatus = zone.phosphorus === null ? null : getNPKStatus(zone.phosphorus, 30, 80);
  const kStatus = zone.potassium === null ? null : getNPKStatus(zone.potassium, 100, 250);

  return (
    <Link
      href={`/irrigation/${zone.id}`}
      data-zone-name={zone.name}
      className="group bg-soil-900 border-2 border-soil-700 rounded-xl p-5 shadow-xl flex flex-col justify-between gap-5 transition-all hover:border-olive-500/60 hover:shadow-2xl"
    >
      {/* Zone Header */}
      <div className="flex items-start justify-between gap-3 border-b border-soil-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-display font-semibold text-parchment">
              {zone.name}
            </h2>
            <ChevronRight className="w-4 h-4 text-parchment/40 group-hover:text-olive-400 group-hover:translate-x-0.5 transition-all shrink-0" />
          </div>
          <p className="text-xs text-parchment/60 font-sans mt-0.5">
            {zone.cropType}
          </p>
        </div>

        {/* Multi-modal Status Indicator (Color + Icon + Text) */}
        <div className="flex items-center gap-2">
          <ZoneValveControlBadge zone={zone} />
          <div
            className={`px-2.5 py-1 rounded-md border text-xs font-mono font-semibold flex items-center gap-1.5 shrink-0 ${statusBadge.color}`}
          >
            {statusBadge.icon}
            <span>{statusBadge.label}</span>
          </div>
        </div>
      </div>

      {/* Main Body */}
      {isDisconnected ? (
        <div className="bg-soil-950/60 border border-clay-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
          <div className="shrink-0">
            <MoistureGauge value={null} target={zone.targetMoisture} size="sm" />
          </div>
          <div className="space-y-2 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 text-clay-400 font-mono font-bold text-sm">
              <AlertOctagon className="w-4 h-4" />
              <span>{t("noDataTitle")}</span>
            </div>
            <p className="text-xs text-parchment/70 font-sans leading-relaxed">
              {t("noDataBody")}
            </p>
            <div className="text-xs font-mono text-parchment/50 pt-1">
              {t("activeNodes")}{" "}
              <span className="text-clay-400 font-bold">
                0{zone.nodeCount !== undefined ? ` / ${zone.nodeCount}` : ""}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_1fr] gap-4 sm:gap-5 items-center">
          {/* Left: Moisture Gauge */}
          <div className="flex flex-col items-center">
            <MoistureGauge
              value={zone.moisture}
              target={zone.targetMoisture}
              size="md"
            />
            <span className="text-[10px] font-mono text-parchment/50 mt-1 uppercase tracking-wider">
              {t("moisture")}
            </span>
          </div>

          {/* Right: NPK Levels & Node Stats */}
          <div className="space-y-3.5">
            {/* NPK Horizontal Bars */}
            <div className="space-y-2 bg-soil-950/50 p-3 rounded-lg border border-soil-800">
              <div className="text-[11px] font-mono uppercase tracking-wider text-parchment/60 flex justify-between">
                <span>{t("npk")}</span>
                <span>{t("normalRange")}</span>
              </div>

              {/* Nitrogen (N) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-parchment/80 font-medium">{t("nNitrogen")}</span>
                  <span className={nStatus?.text ?? "text-parchment/40"}>
                    {zone.nitrogen ?? "—"} <span className="text-[10px] opacity-70">ppm</span>
                    {nStatus && nStatus.status !== "normal" && ` (${nStatus.label})`}
                  </span>
                </div>
                <div className="w-full bg-soil-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${nStatus?.color ?? "bg-soil-700"}`}
                    style={{
                      width: zone.nitrogen === null ? "0%" : `${Math.min(100, (zone.nitrogen / 350) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Phosphorus (P) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-parchment/80 font-medium">{t("pPhosphorus")}</span>
                  <span className={pStatus?.text ?? "text-parchment/40"}>
                    {zone.phosphorus ?? "—"} <span className="text-[10px] opacity-70">ppm</span>
                    {pStatus && pStatus.status !== "normal" && ` (${pStatus.label})`}
                  </span>
                </div>
                <div className="w-full bg-soil-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pStatus?.color ?? "bg-soil-700"}`}
                    style={{
                      width: zone.phosphorus === null ? "0%" : `${Math.min(100, (zone.phosphorus / 100) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Potassium (K) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-parchment/80 font-medium">{t("kPotassium")}</span>
                  <span className={kStatus?.text ?? "text-parchment/40"}>
                    {zone.potassium ?? "—"} <span className="text-[10px] opacity-70">ppm</span>
                    {kStatus && kStatus.status !== "normal" && ` (${kStatus.label})`}
                  </span>
                </div>
                <div className="w-full bg-soil-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${kStatus?.color ?? "bg-soil-700"}`}
                    style={{
                      width: zone.potassium === null ? "0%" : `${Math.min(100, (zone.potassium / 300) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Details: Last Watered & Node count */}
      <div className="pt-3 border-t border-soil-800 flex items-center justify-between gap-2 text-xs font-mono text-parchment/70 flex-wrap">
        <div className="flex items-center gap-1.5" title={t("watered")}>
          <Clock className="w-3.5 h-3.5 text-parchment/50" />
          <span>
            {t("watered")}{" "}
            {zone.lastWatered
              ? /^\d{4}-/.test(zone.lastWatered)
                ? timeAgo(zone.lastWatered)
                : zone.lastWatered
              : t("noRecords")}
          </span>
        </div>

        <div className="flex items-center gap-1.5" title={t("nodes")}>
          <Cpu className="w-3.5 h-3.5 text-parchment/50" />
          <span>
            {t("nodes")}{" "}
            <strong
              className={
                zone.nodeCount === undefined || zone.activeNodeCount === zone.nodeCount
                  ? "text-olive-400"
                  : "text-clay-400"
              }
            >
              {zone.activeNodeCount}
              {zone.nodeCount !== undefined ? `/${zone.nodeCount}` : ""} {t("online")}
            </strong>
          </span>
        </div>
      </div>

      {/* Optional quick-water action — click does not navigate */}
      {onQuickWater && (
        <div className="pt-2 -mt-1 border-t border-soil-800">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onQuickWater(zone);
            }}
            className="w-full min-h-[44px] rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <Droplets className="w-4 h-4" />
            {t("quickWater")}
          </button>
        </div>
      )}
    </Link>
  );
}
