"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL_INTERVAL_MS } from "../constants";
import { apiStatusStore } from "../api-status";

export interface PollingOptions<T> {
  /** Mock data used ONLY when the very first load fails (backend down) so the UI still renders something. */
  fallbackData?: T;
  /** Skip polling until prerequisites (e.g. farmId) resolve. */
  enabled?: boolean;
  intervalMs?: number;
}

export interface PollingResult<T> {
  data: T | undefined;
  /** True only while nothing has loaded yet (first attempt in flight). */
  loading: boolean;
  error: Error | null;
  /** True when a background refresh is running after initial load. */
  refreshing: boolean;
  /** True when `data` currently comes from fallbackData due to a failed first load. */
  isFallback: boolean;
  refetch: () => void;
}

/**
 * Fetch-on-mount + poll-every-POLL_INTERVAL_MS data hook.
 *
 * Guarantees:
 *  - a transient failure NEVER blanks the UI: last good data stays rendered,
 *    the error surfaces separately (and into the TopBar cloud badge);
 *  - empty successful responses are data ([] etc.), not errors.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options?: PollingOptions<T>
): PollingResult<T> {
  const { fallbackData, enabled = true, intervalMs = POLL_INTERVAL_MS } = options ?? {};

  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const dataRef = useRef<T | undefined>(undefined);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const tick = useCallback(async (): Promise<void> => {
    if (!enabled || inFlightRef.current || !mountedRef.current) return;
    inFlightRef.current = true;
    if (dataRef.current !== undefined) setRefreshing(true);
    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current) return;
      dataRef.current = result;
      setData(result);
      setError(null);
      setIsFallback(false);
      apiStatusStore.reportSuccess();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err as Error);
      // First load failed → fall back to mock data rather than a blank page,
      // clearly flagged so callers can show a "demo data" hint.
      if (dataRef.current === undefined && fallbackData !== undefined) {
        dataRef.current = fallbackData;
        setData(fallbackData);
        setIsFallback(true);
      }
      apiStatusStore.reportFailure();
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fallbackData]);

  const refetch = useCallback((): void => {
    void tick();
  }, [tick]);

  // Initial fetch + refetch whenever inputs change
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(dataRef.current === undefined);
    void tick();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  // Poll loop
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, tick]);

  // Global manual refresh (TopBar retry button)
  useEffect(() => {
    const handler = (): void => void tick();
    window.addEventListener("agrigate:refetch", handler);
    return () => window.removeEventListener("agrigate:refetch", handler);
  }, [tick]);

  return { data, loading, error, refetch, refreshing, isFallback };
}
