"use client";

import { useMemo } from "react";
import * as api from "../api";
import type { AlertStatusFilter } from "../api";
import { usePolling, PollingOptions, PollingResult } from "./usePolling";
import { useAuth } from "./useAuth";
import { useFarmContext } from "../farmContext";
import { alertCountStore } from "../alert-count";
import type {
  Alert,
  DashboardData,
  Farm,
  IrrigationLog,
  IrrigationSchedule,
  SensorNode,
  Zone,
  ZoneTrendSeries,
} from "../types";

// ── farms ───────────────────────────────────────────────────────────────────

export function useFarms(options?: PollingOptions<Farm[]>): PollingResult<Farm[]> {
  return usePolling(() => api.getFarms(), [], options);
}

/**
 * THE single farm-id resolver every farm-scoped page uses.
 *
 * - farmer: their OWN farm (account.farmId) — never a sibling farm in the org.
 *   Falls back to the first farm the server returns (which, post-scope-fix,
 *   is the farmer's own farm) and to activeFarm.
 * - technician/admin: the farm they picked from their hub page
 *   (/technician or /admin), stored in sessionStorage farm context.
 *   When NO context is picked, returns undefined → all downstream
 *   hooks disable polling entirely (zero API calls fired).
 */
export function usePrimaryFarmId(): string | undefined {
  const { user } = useAuth();
  const { activeFarm } = useFarmContext();
  const isStaff = user?.role === "admin" || user?.role === "technician";
  const farms = useFarms({ enabled: !isStaff });
  return useMemo(() => {
    if (isStaff) return activeFarm?.farmId ?? undefined;
    // A farmer is hard-scoped to ONE farm (their own). Prefer the explicit
    // account.farmId so a stale list can never leak a sibling farm.
    if (user?.farmId) return user.farmId;
    return farms.data?.[0]?.id ?? activeFarm?.farmId;
  }, [isStaff, user?.farmId, activeFarm?.farmId, farms.data]);
}

// ── dashboard ───────────────────────────────────────────────────────────────

export function useDashboard(
  farmId: string | undefined,
  options?: PollingOptions<DashboardData>
): PollingResult<DashboardData> {
  return usePolling(() => (farmId ? api.getDashboard(farmId) : Promise.reject(new Error("no farm"))), [farmId], {
    ...options,
    enabled: farmId !== undefined && (options?.enabled ?? true),
  });
}

// ── zones ───────────────────────────────────────────────────────────────────

export function useZones(
  farmId: string | undefined,
  options?: PollingOptions<Zone[]> & { includeInactive?: boolean }
): PollingResult<Zone[]> {
  const includeInactive = options?.includeInactive === true;
  return usePolling(
    () => (farmId ? api.getZones(farmId, { includeInactive }) : Promise.reject(new Error("no farm"))),
    [farmId, includeInactive],
    { ...options, enabled: farmId !== undefined && (options?.enabled ?? true) }
  );
}

// ── nodes ───────────────────────────────────────────────────────────────────

export function useNodes(
  farmId: string | undefined,
  options?: PollingOptions<SensorNode[]> & { includeInactive?: boolean }
): PollingResult<SensorNode[]> {
  const includeInactive = options?.includeInactive === true;
  return usePolling(
    () => (farmId ? api.getNodes(farmId, { includeInactive }) : Promise.reject(new Error("no farm"))),
    [farmId, includeInactive],
    { ...options, enabled: farmId !== undefined && (options?.enabled ?? true) }
  );
}

// ── alerts ──────────────────────────────────────────────────────────────────

export function useAlerts(
  farmId: string | undefined,
  status?: AlertStatusFilter,
  options?: PollingOptions<Alert[]>
): PollingResult<Alert[]> {
  const result = usePolling(
    () => (farmId ? api.getAlerts(farmId, status) : Promise.reject(new Error("no farm"))),
    [farmId, status],
    {
      ...options,
      enabled: farmId !== undefined && (options?.enabled ?? true),
    }
  );
  // Keep the sidebar badge in sync with whichever alerts hook last succeeded.
  if (!status && result.data) alertCountStore.set(result.data.length);
  return result;
}

// ── irrigation ──────────────────────────────────────────────────────────────

export function useSchedules(
  farmId: string | undefined,
  options?: PollingOptions<IrrigationSchedule[]>
): PollingResult<IrrigationSchedule[]> {
  return usePolling(
    () => (farmId ? api.getSchedules(farmId) : Promise.reject(new Error("no farm"))),
    [farmId],
    { ...options, enabled: farmId !== undefined && (options?.enabled ?? true) }
  );
}

export function useIrrigationLogs(
  farmId: string | undefined,
  options?: PollingOptions<IrrigationLog[]>
): PollingResult<IrrigationLog[]> {
  return usePolling(
    () => (farmId ? api.getIrrigationLogs(farmId) : Promise.reject(new Error("no farm"))),
    [farmId],
    { ...options, enabled: farmId !== undefined && (options?.enabled ?? true) }
  );
}

// ── telemetry trend ────────────────────────────────────────────────────────

export function useTelemetryTrend(
  farmId: string | undefined,
  hours = 24,
  options?: PollingOptions<{ zones: ZoneTrendSeries[] }>
): PollingResult<{ zones: ZoneTrendSeries[] }> {
  return usePolling(
    () => (farmId ? api.getTelemetryTrend(farmId, hours) : Promise.reject(new Error("no farm"))),
    [farmId, hours],
    { ...options, enabled: farmId !== undefined && (options?.enabled ?? true) }
  );
}
