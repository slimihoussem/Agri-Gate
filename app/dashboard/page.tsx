"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Droplets,
  Cpu,
  Waves,
  AlertTriangle,
  ArrowRight,
  Trees,
  WifiOff,
  RefreshCw,
} from "lucide-react";

import { Alert, Zone } from "@/lib/types";
import { acknowledgeAlert } from "@/lib/api";
import {
  usePrimaryFarmId,
  useDashboard,
  useZones,
  useAlerts,
  useTelemetryTrend,
} from "@/lib/hooks";
import { useAuth } from "@/lib/hooks/useAuth";
import { useFarmContext } from "@/lib/farmContext";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { StatCard } from "@/components/StatCard";
import { ZoneCard } from "@/components/ZoneCard";
import { AlertRow } from "@/components/AlertRow";
import { MoistureTrendChart } from "@/components/MoistureTrendChart";
import { ZoneCardSkeleton, RowSkeleton, SkeletonBlock, StatCardSkeleton } from "@/components/Skeleton";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const { user, loading: authLoading } = useAuth();
  const { activeFarm } = useFarmContext();
  const router = useRouter();

  // Part 14 amendment: admin AND technician have no home farm — redirect to
  // their respective landing pages when no farm context is picked.
  useEffect(() => {
    if (authLoading || !user) return;
    if (user.role === "admin" && !activeFarm) router.replace("/admin");
    if (user.role === "technician" && !activeFarm) router.replace("/technician");
  }, [authLoading, user, activeFarm, router]);

  const farmId = usePrimaryFarmId();
  const dashboard = useDashboard(farmId);
  const zones = useZones(farmId);
  const alerts = useAlerts(farmId, "active");
  const trend = useTelemetryTrend(farmId, 24);

  // Optimistic acknowledgements on the recent-alerts preview
  const [optimisticAcked, setOptimisticAcked] = useState<Set<string>>(new Set());
  const [ackError, setAckError] = useState<string | null>(null);

  const stats = dashboard.data?.stats;
  const zoneList: Zone[] = zones.data ?? [];
  const allActiveAlerts = alerts.data ?? [];
  const activeAlerts: Alert[] = allActiveAlerts
    .filter((a) => !optimisticAcked.has(a.id))
    .slice(0, 5);

  const openAlertCount =
    stats?.openAlerts ?? Math.max(0, allActiveAlerts.length - optimisticAcked.size);

  const handleAcknowledge = async (alertId: string): Promise<void> => {
    setOptimisticAcked((prev) => new Set(prev).add(alertId));
    try {
      await acknowledgeAlert(alertId);
      await Promise.all([alerts.refetch(), dashboard.refetch()]);
      setOptimisticAcked(new Set());
    } catch (err) {
      setOptimisticAcked((prev) => {
        const next = new Set(prev);
        next.delete(alertId); // rollback on failure
        return next;
      });
      setAckError(t("ackFailed", { message: (err as Error).message }));
      setTimeout(() => setAckError(null), 5000);
    }
  };

  const heroLoading = dashboard.loading && stats === undefined;
  const isTechnicianVisit = user?.role === "technician";
  const activeFarmCtx = useFarmContext().activeFarm;

  // Part 14 amendment: technician sees work-oriented framing, farmer sees crop framing
  const pageTitle = isTechnicianVisit
    ? t("techTitle", { farm: activeFarmCtx?.farmName ?? farmId ?? "" })
    : t("pageTitle");
  const pageSubtitle = isTechnicianVisit
    ? t("techSubtitle")
    : t("pageSubtitle");

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-soil-800 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment">
            {isTechnicianVisit ? t("techTitle", { farm: activeFarmCtx?.farmName ?? farmId ?? "" }) : t("pageTitle")}
          </h1>
          <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
            {isTechnicianVisit ? t("techSubtitle") : t("pageSubtitle")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {(dashboard.refreshing || zones.refreshing || alerts.refreshing) && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-soil-900 border border-soil-700 text-xs font-mono text-parchment/50">
              <RefreshCw className="w-3 h-3 animate-spin motion-reduce:animate-none" />
              <span>{t("refreshing")}</span>
            </span>
          )}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-soil-900 border border-soil-700 text-xs font-mono text-parchment/80">
            <span className="w-2 h-2 rounded-full bg-olive-400 animate-pulse motion-reduce:animate-none" />
            <span>{t("live20s")}</span>
          </div>
        </div>
      </div>

      {/* Fallback notice (API down before first success) OR transient ack error */}
      {zones.isFallback || dashboard.isFallback ? (
        <div className="p-3.5 rounded-xl bg-wheat-600/15 border-2 border-wheat-500/40 text-wheat-400 text-sm font-mono flex items-center gap-2">
          <WifiOff className="w-5 h-5 shrink-0" />
          <span>{t("fallbackNotice")}</span>
        </div>
      ) : null}
      {ackError ? (
        <div className="p-3.5 rounded-xl bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-sm font-mono flex items-center gap-2 shadow-lg">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{ackError}</span>
        </div>
      ) : null}

      {/* 1. Hero Row: 4 StatCards */}
      <section aria-label={t("farmKeyMetrics")} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {heroLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              icon={Droplets}
              label={t("avgMoisture")}
              value={stats?.avgMoisture != null ? String(stats.avgMoisture) : "—"}
              unit="%"
              statusColor={
                stats?.avgMoisture == null
                  ? "olive"
                  : stats.avgMoisture >= 45 && stats.avgMoisture <= 60
                    ? "olive"
                    : "wheat"
              }
              subtext={t("avgMoistureSub")}
            />

            <StatCard
              icon={Cpu}
              label={t("activeNodes")}
              value={stats ? `${stats.activeNodes}` : "—"}
              unit={stats ? ` ${t("online", { total: stats.totalNodes })}` : ""}
              statusColor={
                stats && stats.totalNodes > 0 && stats.activeNodes < stats.totalNodes
                  ? "wheat"
                  : "olive"
              }
              subtext={
                stats && stats.activeNodes < stats.totalNodes
                  ? t("nodesOffline", { count: stats.totalNodes - stats.activeNodes })
                  : t("allReporting")
              }
            />

            <StatCard
              icon={Waves}
              label={t("waterToday")}
              value={stats ? stats.waterUsedTodayL.toLocaleString() : "—"}
              unit={t("litres")}
              statusColor="olive"
              subtext={t("waterTodaySub")}
            />

            <StatCard
              icon={AlertTriangle}
              label={t("openAlerts")}
              value={openAlertCount}
              unit={t("alertsActive")}
              statusColor={openAlertCount > 2 ? "clay" : openAlertCount > 0 ? "wheat" : "olive"}
              subtext={t("alertsSub", {
                critical: allActiveAlerts.filter((a) => a.severity === "critical").length,
                warnings: allActiveAlerts.filter((a) => a.severity === "warning").length,
              })}
            />
          </>
        )}
      </section>

      {/* 2. Zone Grid */}
      <section aria-label={t("zoneTelemetry")} className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-display font-bold text-parchment flex items-center gap-2">
              <Trees className="w-5 h-5 text-olive-400" />
              <span>{t("farmSectors")}</span>
            </h2>
            <p className="text-xs text-parchment/60 font-sans mt-0.5">
              {t("farmSectorsSub")}
            </p>
          </div>

          <span className="hidden sm:inline-block text-xs font-mono text-parchment/50">
            {zoneList.length > 0 ? t("zonesMonitored", { count: zoneList.length }) : ""}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {zoneList.length > 0
            ? zoneList.map((zone) => <ZoneCard key={zone.id} zone={zone} />)
            : Array.from({ length: 3 }).map((_, i) => <ZoneCardSkeleton key={i} />)}
        </div>
      </section>

      {/* 3. 24h Moisture Trend (generic per-zone series from the API) */}
      <section aria-label={t("moistureHistoryAria")}>
        {trend.loading && trend.data === undefined ? (
          <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-5 space-y-4">
            <SkeletonBlock className="h-6 w-64" />
            <SkeletonBlock className="h-72 w-full" />
          </div>
        ) : (
          <MoistureTrendChart zones={trend.data?.zones ?? []} />
        )}
      </section>

      {/* 4. Recent Alerts */}
      <section aria-label={t("recentAlerts")} className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-display font-bold text-parchment flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-wheat-400" />
              <span>{t("recentAlerts")}</span>
            </h2>
            <p className="text-xs text-parchment/60 font-sans mt-0.5">
              {t("recentAlertsSub")}
            </p>
          </div>

          <Link
            href="/alerts"
            className="min-h-[48px] px-4 py-2 rounded-lg bg-soil-900 hover:bg-soil-800 text-olive-400 border border-soil-700 hover:border-olive-500 font-mono text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span>{t("viewAllAlerts", { count: allActiveAlerts.length })}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="space-y-3">
          {alerts.loading && activeAlerts.length === 0
            ? Array.from({ length: 3 }).map((_, i) => <RowSkeleton key={i} lines={2} />)
            : activeAlerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
              ))}
        </div>
      </section>
    </div>
  );
}
