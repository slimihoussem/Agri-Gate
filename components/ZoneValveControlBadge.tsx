"use client";

import { AlertTriangle, Droplet } from "lucide-react";
import { Zone } from "@/lib/types";
import { useTranslations } from "next-intl";

/**
 * Safety indicator: a zone that HAS nodes but ZERO active actuators has no
 * valve to command, so water can never be controlled from the platform.
 * Distinct from "disconnected" (which is about sensor telemetry, not valves).
 *
 * Part 19 addition: when the zone HAS a dedicated main-valve (zone valve), a
 * droplet shows its live open/closed state — filled olive = open, outlined =
 * closed.
 */
export function ZoneValveControlBadge({ zone }: { zone: Zone }) {
  const t = useTranslations("zoneValveBadge");
  const hasNodes = (zone.nodeCount ?? 0) > 0;
  const hasActiveValve = (zone.activeActuatorCount ?? 0) > 0;

  if (zone.hasZoneValve) {
    return zone.zoneValveRunning ? (
      <span
        title={t("valveOpenTitle")}
        className="inline-flex items-center gap-1 rounded-full border border-olive-500/40 bg-olive-500/15 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-olive-400"
      >
        <Droplet className="w-3 h-3 fill-olive-400" />
        {t("valveOpen")}
      </span>
    ) : (
      <span
        title={t("valveClosedTitle")}
        className="inline-flex items-center gap-1 rounded-full border border-soil-600 bg-soil-800/60 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-parchment/50"
      >
        <Droplet className="w-3 h-3" />
        {t("valveClosed")}
      </span>
    );
  }

  if (!hasNodes || hasActiveValve) return null;
  return (
    <span
      title={t("noValveControlTitle")}
      className="inline-flex items-center gap-1.5 rounded-full border border-clay-500/40 bg-clay-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-clay-400"
    >
      <AlertTriangle className="w-3 h-3" />
      {t("noValveControl")}
    </span>
  );
}
