"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "./api";
import { useAuth } from "@/lib/hooks/useAuth";

/**
 * Farm context for PLATFORM ADMINS (Part 12).
 *
 * Client users are permanently tied to their org — this context is ignored
 * for them. Platform admins have no home org: when they click into a farm
 * from /admin, that farm becomes their "active farm" and every page's
 * farm-scoped fetches use its id, exactly as a normal client user would
 * experience. Persisted in sessionStorage so it survives navigation but not
 * the browser session.
 *
 * NOTE: this is convenience routing only. Every API call remains enforced by
 * the backend's explicit-farmId + tenant rules.
 */

export interface ActiveFarm {
  farmId: string;
  farmName: string;
  orgId: string;
  orgName: string;
}

interface FarmContextValue {
  /** The farm a platform admin is currently viewing (null = none picked). */
  activeFarm: ActiveFarm | null;
  setActiveFarm: (farm: ActiveFarm | null) => void;
  /** Farms visited this session — feeds the TopBar switcher. */
  history: ActiveFarm[];
  clear: () => void;
}

const STORAGE_KEY = "agrigate_farm_context";
const HISTORY_KEY = "agrigate_farm_history";

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — context simply won't persist */
  }
}

const FarmContext = createContext<FarmContextValue>({
  activeFarm: null,
  setActiveFarm: () => undefined,
  history: [],
  clear: () => undefined,
});

export function FarmContextProvider({ children }: { children: React.ReactNode }) {
  const [activeFarm, setActiveFarmState] = useState<ActiveFarm | null>(null);
  const [history, setHistory] = useState<ActiveFarm[]>([]);

  useEffect(() => {
    setActiveFarmState(readSession<ActiveFarm>(STORAGE_KEY));
    setHistory(readSession<ActiveFarm[]>(HISTORY_KEY) ?? []);
  }, []);

  const setActiveFarm = useCallback((farm: ActiveFarm | null): void => {
    writeSession(STORAGE_KEY, farm);
    setActiveFarmState(farm);
    if (farm) {
      const hist = readSession<ActiveFarm[]>(HISTORY_KEY) ?? [];
      const deduped = [farm, ...hist.filter((h) => h.farmId !== farm.farmId)].slice(0, 8);
      writeSession(HISTORY_KEY, deduped);
      setHistory(deduped);
    }
  }, []);

  const clear = useCallback((): void => {
    writeSession(STORAGE_KEY, null);
    writeSession(HISTORY_KEY, null);
    setActiveFarmState(null);
    setHistory([]);
  }, []);

  const value = useMemo(
    () => ({ activeFarm, setActiveFarm, history, clear }),
    [activeFarm, setActiveFarm, history, clear]
  );

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

export function useFarmContext(): FarmContextValue {
  return useContext(FarmContext);
}

/** Convenience for pages: platform admin → context farm; client user → own farm. */
export function useResolvedFarmId(user: AuthUser | null | undefined): string | undefined {
  const ctx = useFarmContext();
  if (user?.role === "admin") return ctx.activeFarm?.farmId;
  // Client users resolve through their own org-scoped farms list upstream.
  return undefined;
}
