"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Map as MapIcon,
  Cpu,
  Bell,
  Droplet,
  Info,
  SlidersHorizontal,
  Building2,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import { canManageInfrastructure } from "@/lib/api";
import { useFarmContext } from "@/lib/farmContext";
import { alertCountStore } from "@/lib/alert-count";
import { API_BASE_URL } from "@/lib/constants";
import { useTranslations } from "next-intl";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

export function Sidebar() {
  const t = useTranslations("nav");
  const tMeta = useTranslations("meta");
  const pathname = usePathname();
  const { user } = useAuth();
  const { activeFarm } = useFarmContext();
  const alertCount = useSyncExternalStore(
    alertCountStore.subscribe,
    () => alertCountStore.get(),
    () => 0 // server snapshot: count starts at 0 during SSR
  );

  const isStaff = user?.role === "admin" || user?.role === "technician";
  const hasFarm = Boolean(activeFarm?.farmId);
  const showFarmScoped = !isStaff || hasFarm;
  const hubHref = user?.role === "technician" ? "/technician" : "/admin";

  // ─── Dynamic branding subtitle ──────────────────────────────────────────
  // The logo subtitle must never hardcode a specific pilot farm. When a farm
  // context is active (staff picked a farm, or a farmer's own org) we resolve
  // that farm's REAL location from the API and append it; otherwise (staff
  // hubs with no farm selected, pre-login shell) we show generic "PRECISION
  // IOT" only. Same source as the TopBar header fix.
  const [farmLocation, setFarmLocation] = useState<string>("");

  useEffect(() => {
    if (!user) {
      setFarmLocation("");
      return;
    }
    let mounted = true;

    if (isStaff && activeFarm?.farmId) {
      fetch(`${API_BASE_URL}/api/farms/${activeFarm.farmId}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((farm) => {
          if (mounted && farm) {
            setFarmLocation(farm?.location ?? "");
          }
        })
        .catch(() => {});
      return () => {
        mounted = false;
      };
    }

    if (user.role === "farmer") {
      fetch(`${API_BASE_URL}/api/farms`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((farms) => {
          if (mounted && farms && farms.length > 0) {
            setFarmLocation(farms[0]?.location ?? "");
          }
        })
        .catch(() => {});
    } else {
      setFarmLocation("");
    }

    return () => {
      mounted = false;
    };
  }, [user, isStaff, activeFarm?.farmId]);

  const brandSubtitle = farmLocation
    ? `PRECISION IOT • ${farmLocation}`
    : "PRECISION IOT";

  // ─── Imperative nav builder: push each item EXACTLY once ─────────────────
  // Using push() instead of spread/concat makes structural duplication
  // impossible regardless of state-transition timing.
  const items: NavItem[] = [];

  // Dashboard: staff without context → hub page; everyone else → /dashboard
  if (isStaff && !hasFarm) {
    items.push({ href: hubHref, label: t("dashboard"), icon: LayoutDashboard });
  } else {
    items.push({ href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard });
  }

  // Farm-scoped pages: only when context is active OR farmer (own org)
  if (showFarmScoped) {
    items.push({ href: "/map", label: t("farmMap"), icon: MapIcon });
    items.push({ href: "/devices", label: t("sensorsNodes"), icon: Cpu });
    items.push({ href: "/alerts", label: t("alerts"), icon: Bell, badge: alertCount });
    items.push({ href: "/irrigation", label: t("irrigation"), icon: Droplet });
  }

  // Settings: technician+ with context, or admin always
  if ((canManageInfrastructure(user) && hasFarm) || (user?.role === "admin" && !hasFarm)) {
    items.push({ href: "/settings", label: t("settings"), icon: SlidersHorizontal });
  }

  // Admin console: admin role only
  if (user?.role === "admin") {
    items.push({ href: "/admin", label: t("admin"), icon: Building2 });
  }

  // ─── Structural safety net: deduplicate by href ──────────────────────────
  // Even if a future edit accidentally double-pushes, this guarantees
  // exactly one nav item per unique href.
  const seen = new Set<string>();
  const navItems = items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });

  return (
    <aside className="hidden md:flex flex-col w-64 bg-soil-900 border-r border-soil-700 min-h-screen shrink-0 sticky top-0 h-screen justify-between p-4 z-20">
      <div className="space-y-6">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3 px-3 py-2">
          <Image
            src="/logo-sidebar.png"
            alt="AgriGate logo"
            width={40}
            height={40}
            priority
            className="w-10 h-10 object-contain"
          />
          <div>
            <h1 className="text-xl font-display font-bold text-parchment tracking-tight">AgriGate</h1>
            <p className="text-[11px] font-mono text-olive-400 font-medium tracking-wide">{brandSubtitle}</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="space-y-1.5" aria-label={t("mainNavigation")}>
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                item.href !== hubHref &&
                pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`min-h-[48px] px-3.5 py-3 rounded-xl flex items-center justify-between text-sm font-medium transition-all group ${
                  isActive
                    ? "bg-olive-600/15 text-olive-400"
                    : "text-parchment/60 hover:text-parchment hover:bg-soil-800/60"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5]" : ""}`} />
                  <span>{item.label}</span>
                </span>
                {"badge" in item && typeof item.badge === "number" && item.badge > 0 && (
                  <span className="px-1.5 min-w-[22px] h-5 rounded-full bg-clay-500 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer */}
      <div className="space-y-2 px-3">
        <div className="p-3 rounded-lg bg-soil-950/60 border border-soil-800 text-[10px] font-sans text-parchment/40 leading-relaxed flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-olive-500/60" />
          <span>{tMeta("versionFooter")}</span>
        </div>
      </div>
    </aside>
  );
}
