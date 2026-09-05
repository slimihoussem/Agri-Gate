"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Map as MapIcon,
  Cpu,
  WifiOff,
  Bell,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useFarmContext } from "@/lib/farmContext";
import { SkeletonBlock } from "@/components/Skeleton";
import { useTranslations } from "next-intl";
import { getStaffFarms, type StaffFarm } from "@/lib/api";
import { POLL_INTERVAL_MS } from "@/lib/constants";

/**
 * Technician landing page — Part 14 amendment.
 * Lists every farm with operational stats so the technician can triage
 * where to work. NOT a client-management view (no Add Client, no user mgmt).
 */
type SortMode = "name" | "attention";

export default function TechnicianPage() {
  const t = useTranslations("pageHeadings");
  const tb = useTranslations("pageBits");
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { setActiveFarm } = useFarmContext();
  const [farms, setFarms] = useState<StaffFarm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("attention");

  const isStaff = user?.role === "admin" || user?.role === "technician";

  useEffect(() => {
    if (!authLoading && !isStaff) {
      router.replace("/dashboard");
    }
  }, [authLoading, isStaff, router]);

  useEffect(() => {
    if (!isStaff) return;
    let mounted = true;
    const tick = async (): Promise<void> => {
      try {
        const list = await getStaffFarms();
        if (mounted) setFarms(list);
      } catch (err) {
        if (mounted) setError((err as Error).message);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => { mounted = false; clearInterval(timer); };
  }, [isStaff]);

  const sorted = useMemo(() => {
    if (!farms) return [];
    if (sortMode === "attention") {
      // Needs-attention first: offline nodes + critical alerts descending.
      return [...farms].sort((a, b) => {
        const aNeeds = a.offlineNodeCount + a.openAlertCount;
        const bNeeds = b.offlineNodeCount + b.openAlertCount;
        return bNeeds - aNeeds;
      });
    }
    return [...farms].sort((a, b) => a.farmName.localeCompare(b.farmName));
  }, [farms, sortMode]);

  if (!authLoading && !isStaff) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="border-b border-soil-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment flex items-center gap-3">
          <MapIcon className="w-7 h-7 text-olive-400" />
          <span>{t("techTitle")}</span>
        </h1>
        <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
          {t("techSub")}
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-sm font-mono">
          {error}
        </div>
      )}

      {/* Sort toggle */}
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="text-parchment/50">{tb("sort")}</span>
        {(["attention", "name"] as SortMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSortMode(mode)}
            className={`min-h-[44px] px-4 rounded-lg border transition-colors ${
              sortMode === mode
                ? "bg-soil-800 text-parchment border-soil-600"
                : "bg-soil-950 text-parchment/50 border-soil-800 hover:text-parchment"
            }`}
          >
            {mode === "attention" ? "Needs attention" : "Name"}
          </button>
        ))}
      </div>

      {/* Farm cards */}
      {farms === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-xs font-mono text-parchment/50 py-6 text-center">{tb("noFarmsAvailable")}</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((farm) => {
            const needsAttention =
              farm.offlineNodeCount > 0 || farm.openAlertCount > 0;
            return (
              <li key={farm.farmId}>
                <button
                  type="button"
                  onClick={() => {
                    // Part 14 amendment: use the SAME React context mechanism
                    // as the admin console — setActiveFarm updates BOTH React
                    // state AND sessionStorage, so /dashboard's guard passes.
                    setActiveFarm({
                      farmId: farm.farmId,
                      farmName: farm.farmName,
                      orgId: "",
                      orgName: farm.orgName,
                    });
                    router.push("/dashboard");
                  }}
                  className={`w-full min-h-[72px] px-5 py-4 rounded-xl border-2 transition-all text-left group ${
                    needsAttention
                      ? "bg-wheat-950/20 border-wheat-500/40 hover:border-wheat-500/70"
                      : "bg-soil-900 border-soil-700 hover:border-olive-500/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-display font-bold text-parchment truncate">{farm.farmName}</span>
                        {needsAttention && (
                          <span className="px-1.5 py-px rounded text-[10px] font-mono font-bold bg-clay-500 text-white">
                            ATTENTION
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-parchment/50 mt-0.5">{farm.orgName}</div>
                    </div>
                    <div className="font-mono text-xs text-parchment/70 flex items-center gap-4 shrink-0 flex-wrap justify-end">
                      <span className="flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-parchment/40" />
                        <span>{farm.activeNodeCount}/{farm.nodeCount}</span>
                        <span className="text-parchment/40">{tb("nodeCountLabel")}</span>
                      </span>
                      {farm.offlineNodeCount > 0 && (
                        <span className="flex items-center gap-1.5 text-clay-400">
                          <WifiOff className="w-3.5 h-3.5" />
                          <span>{farm.offlineNodeCount} offline</span>
                        </span>
                      )}
                      <span className={`flex items-center gap-1.5 ${farm.openAlertCount > 0 ? "text-wheat-400" : "text-parchment/40"}`}>
                        <Bell className="w-3.5 h-3.5" />
                        <span>{farm.openAlertCount}</span>
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
