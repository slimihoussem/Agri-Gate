"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  Cloud,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Radio,
  Loader2,
  LogOut,
  Sprout,
  Wrench,
  ShieldCheck,
  Building2,
  ChevronDown,
  Languages,
  Sun,
  Moon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiStatusStore } from "@/lib/api-status";
import { POLL_INTERVAL_MS, API_BASE_URL } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import { useAuth } from "@/lib/hooks/useAuth";
import { useFarmContext, type ActiveFarm } from "@/lib/farmContext";
import { logout, canManageInfrastructure } from "@/lib/api";
import { usePreferences, SUPPORTED_LANGUAGES } from "@/lib/preferences";

interface TopBarProps {
  farmName?: string;
  location?: string;
}

// Part 14: farmName/location are computed internally from the shared farm
// context — no longer accepted as static props to prevent stale values.
const ROLE_META = {
  farmer: { icon: <Sprout className="w-3.5 h-3.5" />, style: "bg-olive-600/20 text-olive-400 border-olive-500/40" },
  technician: { icon: <Wrench className="w-3.5 h-3.5" />, style: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40" },
  admin: { icon: <ShieldCheck className="w-3.5 h-3.5" />, style: "bg-clay-600/20 text-clay-400 border-clay-500/40" },
} as const;

export function TopBar() {
  const router = useRouter();
  const tTop = useTranslations("topbar");
  const { user, loading } = useAuth();
  const { activeFarm, history, setActiveFarm, clear } = useFarmContext();
  const { language, theme, setLanguage, toggleTheme } = usePreferences();
  const isStaffRole = user?.role === "admin" || user?.role === "technician";
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const roleLabel = (role: "farmer" | "technician" | "admin"): string =>
    ({ farmer: tTop("roleFarmer"), technician: tTop("roleTechnician"), admin: tTop("roleAdmin") })[role];

  // ── Dynamic farm identity ──
  // Staff (admin/technician): resolves the farm they picked from context.
  // Farmer: fetches own org's farm list (auto-scoped server-side), takes first.
  const [farmIdentity, setFarmIdentity] = useState<{ name: string; location: string } | null>(null);

  useEffect(() => {
    if (!user) { setFarmIdentity(null); return; }
    let mounted = true;

    if (isStaffRole && activeFarm?.farmId) {
      // Staff with explicit farm context — look up that specific farm.
      fetch(`${API_BASE_URL}/api/farms/${activeFarm.farmId}`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((farm) => {
          if (mounted && farm) {
            setFarmIdentity({ name: farm.name, location: farm.location ?? "" });
          }
        })
        .catch(() => {});

      return () => { mounted = false; };
    }

    if (user.role === "farmer") {
      // Farmer: auto-scoped list returns their own farm(s).
      fetch(`${API_BASE_URL}/api/farms`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((farms) => {
          if (mounted && farms && farms.length > 0) {
            setFarmIdentity({ name: farms[0].name, location: farms[0].location ?? "" });
          }
        })
        .catch(() => {});
    } else {
      setFarmIdentity(null);
    }

    return () => { mounted = false; };
  }, [user, isStaffRole, activeFarm?.farmId]);

  const displayFarmName = farmIdentity
    ? `AgriGate • ${farmIdentity.name}`
    : user?.role === "admin" || user?.role === "technician"
      ? "AgriGate"
      : "AgriGate";
  const displayLocation = farmIdentity?.location ?? "";

  // Real connection state
  const status = useSyncExternalStore(
    apiStatusStore.subscribe,
    apiStatusStore.getState,
    apiStatusStore.getState
  );

  // Ticker so "synced Xm ago" stays fresh between polls.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const retryAll = () => window.dispatchEvent(new Event("agrigate:refetch"));

  const handleLogout = async (): Promise<void> => {
    try { await logout(); } catch { /* best-effort */ }
    clear();
    window.location.assign("/login");
  };

  const switchToFarm = (farm: ActiveFarm): void => {
    setActiveFarm(farm);
    setSwitcherOpen(false);
    router.push("/dashboard");
    router.refresh();
  };

  const renderBadgeContent = () => {
    if (status.lastSyncAt === null && status.consecutiveFailures === 0) {
      return {
        icon: <Loader2 className="w-4 h-4 text-parchment/60 animate-spin motion-reduce:animate-none" />,
        label: tTop("connecting"), short: "…",
        style: "bg-soil-800/60 text-parchment/70 border-soil-600 hover:bg-soil-800",
      };
    }
    switch (status.state) {
      case "connected":
        return {
          icon: <Cloud className="w-4 h-4 text-olive-400" />,
          label: tTop("connectedSynced", { sync: apiStatusStore.describeLastSync() }),
          short: tTop("online"),
          style: "bg-olive-600/20 text-olive-400 border-olive-500/40 hover:bg-olive-600/30",
        };
      case "offline":
        return {
          icon: <AlertTriangle className="w-4 h-4 text-wheat-400" />,
          label: tTop("offlineRetry", {
            seconds: POLL_INTERVAL_MS / 1000,
            sync: apiStatusStore.describeLastSync(),
          }),
          short: tTop("retry"),
          style: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40 hover:bg-wheat-600/30",
        };
      case "error":
        return {
          icon: <XCircle className="w-4 h-4 text-clay-400" />,
          label: tTop("errorUnreachable", { count: status.consecutiveFailures }),
          short: tTop("error"),
          style: "bg-clay-600/20 text-clay-400 border-clay-500/40 hover:bg-clay-600/30",
        };
    }
  };

  const badge = renderBadgeContent();

  return (
    <header className="sticky top-0 z-30 w-full bg-soil-900/95 backdrop-blur border-b border-soil-700 px-4 sm:px-6 py-3 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Farm & Pilot Identity */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-soil-800 border border-soil-600 flex items-center justify-center text-olive-400 shrink-0 shadow-sm">
            <Radio className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-display font-semibold text-parchment truncate">{displayFarmName}</h1>
            <p className="text-xs text-parchment/60 font-sans truncate">{displayLocation}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {/* ── SINGLE farm-context control (dropdown + exit) ── */}
          {isStaffRole && (
            <FarmContextControl
              activeFarm={activeFarm}
              history={history}
              onSwitch={switchToFarm}
              onExit={() => {
                clear();
                router.push(user?.role === "technician" ? "/technician" : "/admin");
              }}
              role={user!.role}
              switcherOpen={switcherOpen}
              setSwitcherOpen={setSwitcherOpen}
            />
          )}

          {/* Language switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLangOpen((v) => !v)}
              title={tTop("language")}
              aria-label={tTop("language")}
              aria-expanded={langOpen}
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-soil-700 bg-soil-800 text-parchment/70 hover:text-olive-400 hover:border-olive-500/50 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Languages className="w-4 h-4" />
              <span className="hidden md:inline text-[11px] font-mono font-bold uppercase">{language}</span>
            </button>
            {langOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
                <ul
                  role="menu"
                  className="absolute end-0 top-full mt-1 w-36 bg-soil-900 border-2 border-soil-700 rounded-xl shadow-2xl p-1.5 z-50"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <li key={l}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={language === l}
                        onClick={() => {
                          setLanguage(l);
                          setLangOpen(false);
                        }}
                        className={`w-full min-h-[44px] px-3 rounded-lg text-xs font-mono font-bold uppercase flex items-center justify-between gap-2 transition-colors ${
                          language === l
                            ? "bg-olive-600/20 text-olive-400 border border-olive-500/40"
                            : "text-parchment/70 hover:bg-soil-800 hover:text-parchment"
                        }`}
                      >
                        {l}
                        {language === l && <span className="w-1.5 h-1.5 rounded-full bg-olive-400" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={tTop("theme")}
            aria-label={tTop("theme")}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-soil-700 bg-soil-800 text-parchment/70 hover:text-olive-400 hover:border-olive-500/50 flex items-center justify-center transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Cloud Sync Status Badge — real API connectivity */}
          <div className="inline-flex items-stretch rounded-lg border shadow-sm overflow-hidden">
            <div
              title={badge.label}
              aria-live="polite"
              aria-label={`${tTop("cloudSyncStatus")}: ${badge.label}`}
              className={`min-h-[44px] px-3.5 py-2 border-r border-white/10 font-mono text-xs sm:text-sm flex items-center gap-2.5 transition-all cursor-default ${badge.style}`}
            >
              {badge.icon}
              <span className="hidden md:inline font-medium">{badge.label}</span>
              <span className="md:hidden font-medium">{badge.short}</span>
            </div>
            <button
              type="button"
              onClick={retryAll}
              title={tTop("refetchAll")}
              aria-label={tTop("refetchAll")}
              className="min-h-[44px] min-w-[44px] px-2 flex items-center justify-center text-parchment/70 hover:text-olive-400 hover:bg-soil-800 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* User Identity + Logout */}
          <div className="min-h-[44px] pl-1.5 pr-1.5 py-1.5 rounded-lg bg-soil-800 border border-soil-700 flex items-center gap-2.5 text-xs font-sans text-parchment">
            <div className="w-7 h-7 rounded-full bg-soil-700 flex items-center justify-center text-olive-400 shrink-0">
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
              ) : user ? (
                ROLE_META[user.role].icon
              ) : (
                <Sprout className="w-3.5 h-3.5" />
              )}
            </div>
            {!loading && user && (
              <div className="hidden sm:block text-left leading-tight max-w-[140px]">
                <div className="font-medium text-parchment truncate">{user.fullName}</div>
                <span className={`inline-block mt-0.5 px-1.5 py-px rounded text-[10px] font-mono font-bold border ${ROLE_META[user.role].style}`}>
                  {roleLabel(user.role)}
                </span>
              </div>
            )}
            {!loading && user && (
              <button type="button" onClick={handleLogout} title={tTop("signOut")} aria-label={tTop("signOut")}
                className="min-w-[44px] min-h-[44px] -mr-1 rounded-lg flex items-center justify-center text-parchment/60 hover:text-clay-400 hover:bg-soil-700 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Single farm-context dropdown control ────────────────────────────────────

function FarmContextControl({
  activeFarm,
  history,
  onSwitch,
  onExit,
  role,
  switcherOpen,
  setSwitcherOpen,
}: {
  activeFarm: ActiveFarm | null;
  history: ActiveFarm[];
  onSwitch: (farm: ActiveFarm) => void;
  onExit: () => void;
  role: string;
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
}) {
  const tTop = useTranslations("topbar");
  const otherFarms = history.filter((f) => f.farmId !== activeFarm?.farmId);

  return (
    <div className="relative flex items-center gap-1.5">
      {/* Main pill: shows current farm context, click to open quick-switch */}
      <button
        type="button"
        onClick={() => setSwitcherOpen(!switcherOpen)}
        aria-expanded={switcherOpen}
        title={activeFarm ? tTop("managingFarm", { farm: activeFarm.farmName }) : tTop("noFarmSelected")}
        className={`min-h-[44px] px-3 rounded-lg border font-mono text-xs flex items-center gap-2 transition-colors ${
          activeFarm
            ? "bg-soil-800 border-soil-600 text-parchment hover:border-olive-500/50"
            : "bg-clay-600/15 border-clay-500/40 text-clay-400"
        }`}
      >
        <Building2 className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline max-w-[160px] truncate font-medium">
          {activeFarm ? `${tTop("managingShort", { farm: activeFarm.farmName })}` : tTop("noFarmSelected")}
        </span>
        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${switcherOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Exit button — separate explicit action */}
      <button
        type="button"
        onClick={onExit}
        title={role === "technician" ? tTop("exitTech") : tTop("exitAdmin")}
        className="min-h-[44px] px-2.5 rounded-lg bg-soil-800 border border-soil-600 text-parchment/50 hover:text-clay-400 hover:bg-clay-600/10 font-mono text-xs font-bold transition-colors"
      >
        {tTop("exit")}
      </button>

      {/* Quick-switch dropdown */}
      {switcherOpen && otherFarms.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} />
          <div className="absolute top-full mt-1 right-0 w-56 bg-soil-900 border-2 border-soil-700 rounded-xl shadow-2xl p-2 z-50 space-y-0.5">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-parchment/40">{tTop("recentFarms")}</div>
            {otherFarms.map((f) => (
              <button
                key={f.farmId}
                type="button"
                onClick={() => onSwitch(f)}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg text-xs font-mono text-left truncate text-parchment/80 hover:bg-soil-800 transition-colors"
              >
                {f.farmName}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}