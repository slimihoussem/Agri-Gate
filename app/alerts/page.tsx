"use client";

import React, { useState } from "react";
import { Alert } from "@/lib/types";
import { acknowledgeAlert } from "@/lib/api";
import { usePrimaryFarmId, useAlerts } from "@/lib/hooks";
import { AlertRow } from "@/components/AlertRow";
import { RowSkeleton } from "@/components/Skeleton";
import { useTranslations } from "next-intl";
import {
  Bell,
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from "lucide-react";

type FilterTab = "all" | "critical" | "warning" | "info";

export default function AlertsPage() {
  const t = useTranslations("alerts");
  const farmId = usePrimaryFarmId();
  // Server-side status filter (Part 3 API ?status= param) — NOT client-side.
  const active = useAlerts(farmId, "active");
  const acknowledged = useAlerts(farmId, "acknowledged");

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [isAckExpanded, setIsAckExpanded] = useState(false);

  // Optimistic acknowledge with rollback
  const [optimisticAcked, setOptimisticAcked] = useState<Set<string>>(new Set());
  const [ackError, setAckError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const applyAckOverrides = (list: Alert[], isAckList: boolean): Alert[] => {
    if (optimisticAcked.size === 0) return list;
    return list.filter((a) => !(optimisticAcked.has(a.id) && !isAckList));
  };

  const handleAcknowledge = async (alertId: string): Promise<void> => {
    setOptimisticAcked((prev) => new Set(prev).add(alertId));
    setPendingIds((prev) => new Set(prev).add(alertId));
    try {
      await acknowledgeAlert(alertId);
      // Persisted — refresh both lists so counts/sections reflect reality.
      await Promise.all([active.refetch(), acknowledged.refetch()]);
      setOptimisticAcked((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
      setAckError(null);
    } catch (err) {
      // Rollback optimistic state
      setOptimisticAcked((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
      setAckError(t("ackFailed", { message: (err as Error).message }));
      setTimeout(() => setAckError(null), 5000);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
    }
  };

  const filterByTab = (list: Alert[]): Alert[] =>
    activeTab === "all" ? list : list.filter((a) => a.severity === activeTab);

  const activeAlerts = filterByTab(applyAckOverrides(active.data ?? [], false));
  const acknowledgedAlerts = filterByTab(applyAckOverrides(acknowledged.data ?? [], true));

  const loadingLists = (active.loading && active.data === undefined) ||
    (acknowledged.loading && acknowledged.data === undefined);

  const allCount = Math.max(0, (active.data?.length ?? 0) - optimisticAcked.size);
  const criticalCount = (active.data ?? []).filter(
    (a) => a.severity === "critical" && !optimisticAcked.has(a.id)
  ).length;
  const warningCount = (active.data ?? []).filter(
    (a) => a.severity === "warning" && !optimisticAcked.has(a.id)
  ).length;
  const infoCount = (active.data ?? []).filter(
    (a) => a.severity === "info" && !optimisticAcked.has(a.id)
  ).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-soil-800 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment">
            {t("pageTitle")}
          </h1>
          <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
            {t("pageSubtitle")}
          </p>
        </div>
      </div>

      {/* Transient error banner */}
      {ackError && (
        <div className="p-3.5 rounded-xl bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-sm font-mono flex items-center gap-2 shadow-lg animate-in slide-in-from-top-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{ackError}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t("tabAria")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "all"}
          onClick={() => setActiveTab("all")}
          className={`min-h-[48px] px-4 py-2.5 rounded-xl font-mono text-xs font-bold border flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === "all"
              ? "bg-soil-800 text-parchment border-soil-600 shadow-md"
              : "bg-soil-900 text-parchment/60 border-soil-700 hover:text-parchment"
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>{t("allSeverities")}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${allCount > 0 ? "bg-soil-950 text-parchment border border-soil-700" : "bg-soil-800 text-parchment/40"}`}>
            {allCount}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "critical"}
          onClick={() => setActiveTab("critical")}
          className={`min-h-[48px] px-4 py-2.5 rounded-xl font-mono text-xs font-bold border flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === "critical"
              ? "bg-clay-600/25 text-clay-400 border-clay-500/60 shadow-md"
              : "bg-soil-900 text-parchment/60 border-soil-700 hover:text-clay-400"
          }`}
        >
          <AlertOctagon className="w-4 h-4 text-clay-400" />
          <span>{t("critical")}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${criticalCount > 0 ? "bg-clay-500 text-parchment" : "bg-soil-800 text-parchment/40"}`}>
            {criticalCount}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "warning"}
          onClick={() => setActiveTab("warning")}
          className={`min-h-[48px] px-4 py-2.5 rounded-xl font-mono text-xs font-bold border flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === "warning"
              ? "bg-wheat-600/25 text-wheat-400 border-wheat-500/60 shadow-md"
              : "bg-soil-900 text-parchment/60 border-soil-700 hover:text-wheat-400"
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-wheat-400" />
          <span>{t("warning")}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${warningCount > 0 ? "bg-wheat-500 text-soil-950" : "bg-soil-800 text-parchment/40"}`}>
            {warningCount}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "info"}
          onClick={() => setActiveTab("info")}
          className={`min-h-[48px] px-4 py-2.5 rounded-xl font-mono text-xs font-bold border flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === "info"
              ? "bg-olive-600/25 text-olive-400 border-olive-500/60 shadow-md"
              : "bg-soil-900 text-parchment/60 border-soil-700 hover:text-olive-400"
          }`}
        >
          <Info className="w-4 h-4 text-olive-400" />
          <span>{t("info")}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${infoCount > 0 ? "bg-olive-500 text-soil-950" : "bg-soil-800 text-parchment/40"}`}>
            {infoCount}
          </span>
        </button>
      </div>

      {/* Section 1: Active Alerts (server-filtered ?status=active) */}
      <section aria-label={t("activeAlerts", { count: activeAlerts.length })} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-parchment flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-clay-400 animate-pulse motion-reduce:animate-none" />
            <span>{t("activeAlerts", { count: activeAlerts.length })}</span>
          </h2>
          <span className="text-xs font-mono text-parchment/50">
            {t("activeAlertsSub")}
          </span>
        </div>

        {loadingLists ? (
          Array.from({ length: 3 }).map((_, i) => <RowSkeleton key={i} lines={2} />)
        ) : activeAlerts.length > 0 ? (
          <div className="space-y-3">
            {activeAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
            ))}
          </div>
        ) : (
          /* Reassuring Olive Checkmark Empty State — success, not an error */
          <div className="bg-soil-900 border-2 border-olive-500/40 rounded-2xl p-10 text-center space-y-4 shadow-xl">
            <div className="w-14 h-14 rounded-full bg-olive-600/20 border-2 border-olive-500 flex items-center justify-center text-olive-400 mx-auto">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-display font-bold text-parchment">{t("allNormal")}</h3>
              <p className="text-sm font-sans text-parchment/70 max-w-md mx-auto">
                {t("allNormalSub")}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Section 2: Acknowledged Alerts (server-filtered ?status=acknowledged) */}
      <section aria-label={t("ackHistory", { count: acknowledgedAlerts.length })} className="space-y-3 pt-4 border-t border-soil-800">
        <button
          type="button"
          onClick={() => setIsAckExpanded((prev) => !prev)}
          className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-soil-900 border-2 border-soil-700 hover:border-soil-600 flex items-center justify-between text-parchment transition-colors"
          aria-expanded={isAckExpanded}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-olive-400" />
            <span className="font-display font-bold text-base">
              {t("ackHistory", { count: acknowledgedAlerts.length })}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-parchment/60">
            <span>{isAckExpanded ? t("collapse") : t("expand")}</span>
            {isAckExpanded ? (
              <ChevronUp className="w-4 h-4 text-parchment/60" />
            ) : (
              <ChevronDown className="w-4 h-4 text-parchment/60" />
            )}
          </div>
        </button>

        {isAckExpanded && (
          <div className="space-y-3 pt-2">
            {loadingLists ? (
              Array.from({ length: 2 }).map((_, i) => <RowSkeleton key={i} lines={2} />)
            ) : acknowledgedAlerts.length > 0 ? (
              acknowledgedAlerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
              ))
            ) : (
              <div className="bg-soil-900/50 border border-soil-800 rounded-xl p-6 text-center text-xs font-mono text-parchment/50">
                {t("noAcked")}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
