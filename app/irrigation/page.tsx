"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Droplet,
  Trees,
  CalendarCheck,
  Cpu,
  Wrench,
  Activity,
  CloudOff,
} from "lucide-react";
import { usePrimaryFarmId, useZones, useNodes } from "@/lib/hooks";
import { SkeletonBlock } from "@/components/Skeleton";
import { ZoneValveControlBadge } from "@/components/ZoneValveControlBadge";
import type { ZoneStatus } from "@/lib/types";
import { useTranslations } from "next-intl";

const ZONE_STATUS_META = (t: (k: string) => string): Record<ZoneStatus, { label: string; dot: string; ring: string }> => ({
  ok: { label: t("healthy"), dot: "bg-olive-400", ring: "text-olive-400" },
  warning: { label: t("warning"), dot: "bg-wheat-400", ring: "text-wheat-400" },
  critical: { label: t("critical"), dot: "bg-clay-400", ring: "text-clay-400" },
  disconnected: { label: t("disconnected"), dot: "bg-soil-700", ring: "text-parchment/40" },
});

/**
 * Screen 1 — Zones (Part 12 + 017 redesign).
 * Zone-level aggregates only: moisture, node split, schedule count.
 * Each card drills to /irrigation/{zoneId} (card grid + drawer).
 */
export default function IrrigationPage() {
  const t = useTranslations("irrigation");
  const farmId = usePrimaryFarmId();
  const zones = useZones(farmId);
  const nodes = useNodes(farmId);

  const nodeCounts = useMemo(() => {
    const counts: Record<string, { total: number; actuator: number }> = {};
    for (const n of nodes.data ?? []) {
      if (!n.zoneId) continue;
      const c = (counts[n.zoneId] ??= { total: 0, actuator: 0 });
      c.total += 1;
      if (n.isActuator) c.actuator += 1;
    }
    return counts;
  }, [nodes.data]);

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="border-b border-soil-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment flex items-center gap-3">
          <Droplet className="w-7 h-7 text-olive-400" />
          <span>{t("pageTitle")}</span>
        </h1>
        <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
          {t("pageSubtitle")}
        </p>
      </div>

      <section aria-label={t("pageTitle")} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {zones.loading && zones.data === undefined
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-5 space-y-3">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonBlock className="h-4 w-52" />
                <SkeletonBlock className="h-10 w-full" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            ))
          : (zones.data ?? []).map((zone) => {
              const counts = nodeCounts[zone.id] ?? { total: 0, actuator: 0 };
              const meta = ZONE_STATUS_META(t);
              const status = meta[zone.status] ?? meta.disconnected;
              const sensorCount = counts.total - counts.actuator;
              return (
                <Link
                  key={zone.id}
                  href={`/irrigation/${zone.id}`}
                  data-zone-name={zone.name}
                  className="group bg-soil-900 border-2 border-soil-700 hover:border-olive-500/60 rounded-xl p-5 shadow-lg transition-all flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Trees className="w-5 h-5 text-olive-400 shrink-0" />
                        <h2 className="text-lg font-display font-bold text-parchment truncate">{zone.name}</h2>
                      </div>
                      <ChevronRight className="w-5 h-5 text-parchment/40 group-hover:text-olive-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                    <p className="text-xs text-parchment/60 font-sans mt-1 truncate">{zone.cropType}</p>

                    {/* Status + moisture hero */}
                    <div className="mt-4 flex items-center justify-between gap-3 bg-soil-950/70 border border-soil-800 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${status.dot}`} />
                        <span className={`text-[11px] font-mono font-bold uppercase tracking-wider ${status.ring}`}>
                          {status.label}
                        </span>
                        <ZoneValveControlBadge zone={zone} />
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-sm">
                        {zone.status === "disconnected" ? (
                          <CloudOff className="w-4 h-4 text-parchment/40" />
                        ) : (
                          <Droplet className="w-4 h-4 text-olive-400" />
                        )}
                        <strong className="text-parchment">
                          {zone.moisture != null ? `${Math.round(zone.moisture)}%` : "—"}
                        </strong>
                        <span className="text-[10px] text-parchment/40 uppercase">{t("soil")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Aggregates — counters strictly from this zone's own data */}
                  <div className="grid grid-cols-3 gap-2 bg-soil-950/60 rounded-lg p-3 border border-soil-800 font-mono text-xs">
                    <div className="flex items-center gap-1.5 text-parchment/70">
                      <Cpu className="w-3.5 h-3.5 text-wheat-400" />
                      <span>{t("nodes")}</span>
                      <strong className="ml-auto text-parchment">{counts.total}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 text-parchment/70">
                      <Wrench className="w-3.5 h-3.5 text-olive-400" />
                      <span>{t("valves")}</span>
                      <strong className="ml-auto text-olive-400">{counts.actuator}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 text-parchment/70">
                      <Activity className="w-3.5 h-3.5 text-wheat-400" />
                      <span>{t("sensors")}</span>
                      <strong className="ml-auto text-parchment">{sensorCount}</strong>
                    </div>
                    <div className="col-span-3 flex items-center gap-1.5 text-parchment/70 border-t border-soil-800 pt-2 mt-1">
                      <CalendarCheck className="w-3.5 h-3.5 text-wheat-400" />
                      <span>{t("schedules")}</span>
                      <strong className={`ml-auto ${zone.activeScheduleCount ? "text-olive-400" : "text-parchment/40"}`}>
                        {zone.activeScheduleCount ?? 0}
                      </strong>
                    </div>
                  </div>
                </Link>
              );
            })}
      </section>
    </div>
  );
}