"use client";

/**
 * Shared alert count store — Part 14 fix.
 * Single source of truth for the sidebar badge. Updated by whichever hook
 * polls alerts, subscribed to by Sidebar/MobileNav via useSyncExternalStore.
 */

let count = 0;
const listeners = new Set<() => void>();

export const alertCountStore = {
  set(n: number): void {
    if (n === count) return;
    count = n;
    listeners.forEach((fn) => fn());
  },
  get(): number {
    return count;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};
