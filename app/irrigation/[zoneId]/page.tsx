"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Droplet, Gauge, Plus, Battery, Radio } from "lucide-react";
import {
  getZone,
  getZoneNodes,
  canOperateIrrigation,
  type ZoneInfo,
} from "@/lib/api";
import type { SensorNode } from "@/lib/types";
import { SkeletonBlock } from "@/components/Skeleton";
import { NodeDetailModal } from "@/components/NodeDetailModal";
import { ScheduleModal } from "@/components/ScheduleModal";
import { NodeCard } from "@/components/NodeCard";
import { ActuatorControls } from "@/components/NodeCard";
import { AddZoneValveModal } from "@/components/AddZoneValveModal";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTranslations } from "next-intl";

/**
 * Screen 2 — Zone card grid (Part 12 + 017 redesign).
 * Each card = one node in THIS zone (server-filtered). Actuator cards get
 * live valve controls + schedule modal; every card opens the node modal.
 * A ?node=<id> query param (from the legacy /irrigation/{zoneId}/{nodeId}
 * deep link) auto-opens that node's modal on load — the ONLY node-detail UI.
 *
 * Part 19: a dedicated Zone Valve card (main valve) renders ABOVE the
 * field-node grid when the zone has one configured. If none is configured,
 * staff see the "Add Zone Valve" creation form. The valve node is excluded
 * from the field-node grid below.
 */
export default function ZoneNodesPage({ params }: { params: { zoneId: string } }) {
  const t = useTranslations("zoneNodesPage");
  const tCard = useTranslations("nodeCard");
  const zoneId = params.zoneId;
  const { user } = useAuth();
  const canIrrigate = canOperateIrrigation(user);
  const canAddValve = user?.role === "technician" || user?.role === "admin";
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkNodeId = searchParams.get("node");
  const pendingDeepLink = useRef<string | null>(
    deepLinkNodeId && deepLinkNodeId.length > 0 ? deepLinkNodeId : null
  );

  const [zone, setZone] = React.useState<ZoneInfo | null>(null);
  const [nodes, setNodes] = React.useState<SensorNode[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drawerNode, setDrawerNode] = React.useState<SensorNode | null>(null);
  const [scheduleNode, setScheduleNode] = React.useState<SensorNode | null>(null);
  const [showAddValve, setShowAddValve] = React.useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const z = await getZone(zoneId);
      const n = await getZoneNodes(zoneId);
      setZone((prev) => (prev && prev.id === z.id ? z : z));
      setNodes(n);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [zoneId]);

  useEffect(() => {
    let mounted = true;
    void reload();
    const timer = setInterval(() => void reload(), 30_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [reload]);

  // Auto-open the modal for a deep-linked node once the list is loaded.
  useEffect(() => {
    const target = pendingDeepLink.current;
    if (target === null || nodes === null) return;
    pendingDeepLink.current = null;
    const match = nodes.find((n) => n.id === target);
    if (match) {
      setDrawerNode(match);
      // Drop the ?node= param so it doesn't linger in the URL after use.
      if (searchParams.has("node")) {
        router.replace(`/irrigation/${zoneId}`, { scroll: false });
      }
    }
  }, [nodes, searchParams, router, zoneId]);

  const actuators = (nodes ?? []).filter((n) => n.isActuator);
  // Part 19: the zone's main-valve node is presented separately, never in the
  // field-node grid (which stays exclusively field nodes/actuators).
  const zoneValve = (nodes ?? []).find((n) => n.isZoneValve) ?? null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Back link */}
      <Link
        href="/irrigation"
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-mono text-parchment/60 hover:text-olive-400 hover:bg-soil-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("backToZones")}
      </Link>

      {/* Header */}
      <div className="border-b border-soil-800 pb-4 flex items-center gap-3 flex-wrap">
        <Droplet className="w-6 h-6 text-olive-400 shrink-0" />
        {zone ? (
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment">{zone.name}</h1>
            <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-0.5">
              {zone.cropType} · {t("valveCount", { count: actuators.length })} ·{" "}
              {t("nodeCount", { count: (nodes ?? []).length })}
            </p>
          </div>
        ) : error ? (
          <h1 className="text-xl font-display font-bold text-clay-400">{t("zoneUnavailable")}</h1>
        ) : (
          <SkeletonBlock className="h-8 w-64" />
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-sm font-mono">
          {error}
        </div>
      )}

      {/* ── Part 19: Zone Valve (main valve) card ─────────────────────────── */}
      <section aria-label={t("zoneMainValveAria")}>
        {zoneValve ? (
          <article
            data-zone-valve-id={zoneValve.id}
            onClick={() => setDrawerNode(zoneValve)}
            role="button"
            tabIndex={0}
            aria-label={tCard("openNodeDetails", { name: zoneValve.name })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target === e.currentTarget) setDrawerNode(zoneValve);
            }}
            className="group cursor-pointer bg-soil-900 border-2 border-olive-500/50 hover:border-olive-400 rounded-xl p-4 shadow-lg flex flex-col md:flex-row md:items-center gap-3 md:gap-5 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0 md:w-72 md:shrink-0">
              <div className="p-2.5 rounded-lg bg-soil-800 border border-olive-500/40 text-olive-400 shrink-0">
                <Gauge className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-olive-400">
                  {t("valveMain")}
                </p>
                <h2 className="text-lg font-display font-semibold text-parchment truncate">
                  {zoneValve.name}
                </h2>
                <p className="text-[11px] font-mono text-parchment/50 truncate">{zoneValve.id}</p>
              </div>
            </div>
            {/* Part 19: a zone valve carries NO sensor data — battery + RSSI
                are the only node-level telemetry it will ever report. */}
            <div className="grid grid-cols-2 gap-2 bg-soil-950/70 border border-soil-800 rounded-lg p-2.5 font-mono text-xs md:w-72 md:shrink-0">
              <div className="flex items-center gap-1.5 text-parchment/70">
                <Battery className="w-3.5 h-3.5 text-parchment/50" />
                <span className="text-parchment/50">{t("batt")}</span>
                <strong className={`ml-auto ${zoneValve.battery != null ? "text-parchment" : "text-parchment/40"}`}>
                  {zoneValve.battery != null ? `${Math.round(zoneValve.battery)}%` : "—"}
                </strong>
              </div>
              <div className="flex items-center gap-1.5 text-parchment/70">
                <Radio className="w-3.5 h-3.5 text-parchment/50" />
                <span className="text-parchment/50">{t("sig")}</span>
                <strong className={`ml-auto ${zoneValve.rssi != null ? "text-parchment" : "text-parchment/40"}`}>
                  {zoneValve.rssi != null ? `${zoneValve.rssi} dBm` : "—"}
                </strong>
              </div>
            </div>
            <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <ActuatorControls
                nodeId={zoneValve.id}
                nodeName={zoneValve.name}
                canIrrigate={canIrrigate}
                onOpenSchedule={() => setScheduleNode(zoneValve)}
              />
            </div>
          </article>
        ) : (
          <div className="bg-soil-900/70 border-2 border-dashed border-soil-700 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 rounded-lg bg-soil-800 border border-soil-600 text-parchment/40 shrink-0">
                <Gauge className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-parchment/40">
                  {t("valveMain")}
                </p>
                <p className="text-sm font-sans text-parchment/60">{t("noMainValve")}</p>
              </div>
            </div>
            {canAddValve && (
              <button
                type="button"
                onClick={() => setShowAddValve(true)}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 border border-olive-400 font-semibold transition-colors shadow-md text-sm sm:ml-auto"
              >
                <Plus className="w-4 h-4" />
                {t("addZoneValve")}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Node cards — strictly this zone's field nodes from the server */}
      {nodes === null && !error ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: actuators.length || 3 }).map((_, i) => (
            <div key={i} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-4 animate-pulse motion-reduce:animate-none">
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-16 w-full mt-3" />
            </div>
          ))}
        </div>
      ) : nodes !== null && nodes.length === 0 ? (
        <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-12 text-center space-y-3">
          <Droplet className="w-10 h-10 text-parchment/30 mx-auto" />
          <h3 className="text-lg font-display font-semibold text-parchment">{t("noNodes")}</h3>
          <p className="text-xs font-sans text-parchment/60">{t("noNodesSub")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {(nodes ?? [])
            .filter((n) => !n.isZoneValve)
            .map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                canIrrigate={canIrrigate}
                onOpenDrawer={() => setDrawerNode(node)}
                onOpenSchedule={() => setScheduleNode(node)}
              />
            ))}
        </div>
      )}

      {/* Add Zone Valve creation form (staff only, enabled from the empty-state card) */}
      {showAddValve && zone && (
        <AddZoneValveModal
          farmId={zone.farmId}
          zoneId={zone.id}
          zoneName={zone.name}
          onClose={() => setShowAddValve(false)}
          onCreated={() => void reload()}
        />
      )}

      {/* Modal — the single node-detail UI (telemetry, history, controls) */}
      <NodeDetailModal
        node={drawerNode}
        isOpen={drawerNode !== null}
        onClose={() => setDrawerNode(null)}
      />

      {/* Schedule modal for the actuator card "Schedules" button */}
      {scheduleNode && (
        <ScheduleModal
          isOpen
          onClose={() => setScheduleNode(null)}
          nodeId={scheduleNode.id}
          nodeName={scheduleNode.name}
          canIrrigate={canIrrigate}
        />
      )}
    </div>
  );
}