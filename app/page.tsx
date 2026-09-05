"use client";

import React, { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";
import { Loader2 } from "lucide-react";

/**
 * Root — routes by role (Part 14): admins land on /admin, everyone else on
 * the farm dashboard.
 */
export default function HomePage() {
  const [dest, setDest] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const role = data?.user?.role;
        setDest(role === "admin" ? "/admin" : "/dashboard");
      })
      .catch(() => setDest("/login"));
  }, []);

  if (!dest) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-soil-950">
        <Loader2 className="w-6 h-6 text-parchment/50 animate-spin motion-reduce:animate-none" />
      </div>
    );
  }
  window.location.replace(dest);
  return null;
}
