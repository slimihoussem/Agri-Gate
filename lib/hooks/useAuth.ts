"use client";

import { useEffect, useState } from "react";
import { getMe, AuthUser } from "../api";

/**
 * Session hook — Part 10.
 * Resolves the logged-in user from GET /api/auth/me on mount.
 * Used by TopBar (real name + role badge) and pages for role-gated UI.
 *
 * NOTE: hiding controls is a UX convenience only — every mutation is
 * independently enforced server-side by requireRole middleware.
 */
export function useAuth(): { user: AuthUser | null; loading: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = () => {
      getMe()
        .then((me) => {
          if (mounted) {
            setUser(me);
            setLoading(false);
          }
        })
        .catch(() => {
          if (mounted) {
            setUser(null);
            setLoading(false);
          }
        });
    };

    load();

    // Back/forward-cache restore keeps the frozen page JS (no effects re-run),
    // so re-validate on pageshow: after logout a back-nav lands on /login
    // instead of a stale shell. getMe() 401s → api.ts clears farm context +
    // redirects. Safe no-op on normal (non-persisted) loads.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) load();
    };
    window.addEventListener("pageshow", onShow);

    return () => {
      mounted = false;
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  return { user, loading };
}
