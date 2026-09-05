"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Map as MapIcon,
  Cpu,
  Bell,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  getAdminOverview,
  getAdminOrgs,
  type PlatformOverview,
  type AdminOrg,
} from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { useFarmContext } from "@/lib/farmContext";
import { useTranslations } from "next-intl";
import { StatCard } from "@/components/StatCard";
import { SkeletonBlock } from "@/components/Skeleton";

/**
 * Platform Admin Console — READ-ONLY.
 * Cross-tenant aggregate stats + browseable org/farm list. Clicking a farm
 * sets the shared farm context and opens the normal dashboard. All mutating
 * management (orgs, farms, users) lives in Farm Settings.
 */
export default function AdminPage() {
  const t = useTranslations("pageHeadings");
  const tb = useTranslations("pageBits");
  const { user, loading } = useAuth();
  const router = useRouter();
  const { setActiveFarm } = useFarmContext();

  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [o, orgList] = await Promise.all([getAdminOverview(), getAdminOrgs()]);
      setOverview(o);
      setOrgs(orgList);
      if (orgList.length > 0) {
        setExpanded((prev) => ({ ...prev, [orgList[0].orgId]: prev[orgList[0].orgId] ?? true }));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  if (loading || (!isAdmin && !error)) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-9 w-72" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="border-b border-soil-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment flex items-center gap-3">
          <Building2 className="w-7 h-7 text-clay-400" />
          <span>{t("adminTitle")}</span>
        </h1>
        <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
          {t("adminSub")}
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-sm font-mono flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Hero stats */}
      <section aria-label={tb("platformStats")} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {!overview ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-28" />)
        ) : (
          <>
            <StatCard icon={Building2} label="Client Organizations" value={overview.totalOrgs} unit="orgs" statusColor="olive" />
            <StatCard icon={MapIcon} label="Farms" value={overview.totalFarms} unit="total" statusColor="olive" />
            <StatCard
              icon={Cpu}
              label="Active Nodes"
              value={`${overview.totalActiveNodes}`}
              unit={`/ ${overview.totalNodes}`}
              statusColor={overview.totalActiveNodes < overview.totalNodes ? "wheat" : "olive"}
            />
            <StatCard
              icon={Bell}
              label="Open Critical Alerts"
              value={overview.totalOpenCriticalAlerts}
              unit={`of ${overview.totalOpenAlerts} open`}
              statusColor={overview.totalOpenCriticalAlerts > 0 ? "clay" : "olive"}
            />
          </>
        )}
      </section>

      {/* Org list (read-only browse) */}
      <section aria-label={tb("organizations")} className="space-y-4">
        <h2 className="text-lg font-display font-bold text-parchment">{t("clientOrgs")}</h2>
        {orgs === null ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : orgs.length === 0 ? (
          <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-10 text-center text-parchment/50 font-mono text-sm">
            No organizations yet — onboard the first client from Farm Settings.
          </div>
        ) : (
          orgs.map((org) => (
            <div key={org.orgId} className="bg-soil-900 border-2 border-soil-700 rounded-xl overflow-hidden shadow-lg">
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [org.orgId]: !prev[org.orgId] }))}
                aria-expanded={Boolean(expanded[org.orgId])}
                className="w-full min-h-[56px] px-5 py-4 flex items-center justify-between gap-4 hover:bg-soil-950/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Building2 className="w-5 h-5 text-olive-400 shrink-0" />
                  <span className="text-base font-display font-bold text-parchment truncate">{org.orgName}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 font-mono text-xs text-parchment/60">
                  <span>{org.farms.length} farm(s)</span>
                  {expanded[org.orgId] ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </div>
              </button>

              {expanded[org.orgId] && (
                <ul className="border-t border-soil-800 divide-y divide-soil-800">
                  {org.farms.length === 0 && (
                    <li className="px-5 py-4 text-xs font-mono text-parchment/50">{tb("noFarmsYet")}</li>
                  )}
                  {org.farms.map((farm) => (
                    <li key={farm.farmId}>
                      <Link
                        href="/dashboard"
                        data-farm-id={farm.farmId}
                        onClick={() =>
                          setActiveFarm({
                            farmId: farm.farmId,
                            farmName: farm.farmName,
                            orgId: org.orgId,
                            orgName: org.orgName,
                          })
                        }
                        className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-olive-950/30 transition-colors group pl-10"
                      >
                        <span className="flex items-center gap-2.5 min-w-0 text-sm text-parchment group-hover:text-olive-400 transition-colors">
                          <MapIcon className="w-4 h-4 shrink-0 text-parchment/40" />
                          <span className="truncate">{farm.farmName}</span>
                        </span>
                        <span className="font-mono text-xs text-parchment/60 shrink-0 flex items-center gap-4">
                          <span className="flex items-center gap-1.5">
                            <Cpu className="w-3.5 h-3.5" /> {farm.activeNodeCount}/{farm.nodeCount} nodes
                          </span>
                          <span className={`flex items-center gap-1.5 ${farm.openAlertCount > 0 ? "text-wheat-400" : ""}`}>
                            <Bell className="w-3.5 h-3.5" /> {farm.openAlertCount}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}