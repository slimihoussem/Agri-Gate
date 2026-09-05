"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Map as MapIcon,
  Cpu,
  Bell,
  Droplet,
  Settings,
  Building2,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/useAuth";
import { canManageInfrastructure } from "@/lib/api";
import { useFarmContext } from "@/lib/farmContext";
import { alertCountStore } from "@/lib/alert-count";
import { useTranslations } from "next-intl";

interface MobileNavProps {}

export function MobileNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { user } = useAuth();
  const { activeFarm } = useFarmContext();
  const alertCount = useSyncExternalStore(
    alertCountStore.subscribe,
    () => alertCountStore.get(),
    () => 0 // server snapshot
  );

  // Part 14: staff roles (admin/technician) see farm-scoped items ONLY when
  // a farm context is active. Without context: just Dashboard → hub page.
  const isStaff = user?.role === "admin" || user?.role === "technician";
  const hasFarmContext = Boolean(activeFarm?.farmId);
  const showFarmItems = !isStaff || hasFarmContext;
  const hubHref = user?.role === "technician" ? "/technician" : "/admin";

  const navItems = [
    {
      href: isStaff && !hasFarmContext ? hubHref : "/dashboard",
      label: t("home"),
      icon: LayoutDashboard,
    },
    ...(showFarmItems
      ? [
          { href: "/map", label: t("map"), icon: MapIcon },
          { href: "/devices", label: t("nodes"), icon: Cpu },
          { href: "/alerts", label: t("alerts"), icon: Bell, badge: alertCount },
          ...(canManageInfrastructure(user)
            ? [{ href: "/settings", label: t("setup"), icon: Settings }]
            : [{ href: "/irrigation", label: t("water"), icon: Droplet }]),
        ]
      : []),
    ...(user?.role === "admin"
      ? [{ href: "/admin", label: t("admin"), icon: Building2 }]
      : []),
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-soil-900/98 backdrop-blur border-t-2 border-soil-700 px-2 py-1 shadow-2xl safe-area-pb"
      aria-label={t("mobileNavigation")}
    >
      <div className={`grid gap-1 items-center justify-around ${navItems.length <= 3 ? "grid-cols-3" : navItems.length <= 5 ? "grid-cols-5" : "grid-cols-6"}`}>
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
              className={`min-h-[52px] flex flex-col items-center justify-center rounded-lg transition-colors relative py-1 ${
                isActive
                  ? "text-olive-400 bg-olive-950/40"
                  : "text-parchment/60 hover:text-parchment active:bg-soil-800"
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 ${
                    isActive ? "stroke-[2.5] text-olive-400" : ""
                  }`}
                />
                {"badge" in item && item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 px-1 min-w-[16px] h-4 rounded-full bg-clay-500 text-parchment text-[10px] font-mono font-bold flex items-center justify-center border border-soil-900">
                    {item.badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-1 font-sans ${
                  isActive ? "font-bold text-olive-400" : "font-normal"
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0.5 w-6 h-0.5 rounded-full bg-olive-400" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
