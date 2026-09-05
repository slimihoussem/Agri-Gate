"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { TopBar } from "@/components/TopBar";

/**
 * App shell — Part 10 polish.
 * Renders Sidebar/TopBar/MobileNav around every page EXCEPT the standalone
 * login screen (no navigation chrome before authentication).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <>
      {/* Desktop Left Sidebar (hidden on mobile) */}
      <Sidebar />
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <TopBar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 md:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (hidden on desktop md+) */}
      <MobileNav />
    </>
  );
}
