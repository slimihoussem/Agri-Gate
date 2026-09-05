"use client";

import React from "react";

/**
 * Loading skeleton primitives — reuse existing card/table shapes with a
 * subtle pulse. `motion-reduce:animate-none` honours prefers-reduced-motion.
 */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse motion-reduce:animate-none rounded-lg bg-soil-800/70 ${className}`}
    />
  );
}

/** Mirrors StatCard proportions while loading the dashboard hero row. */
export function StatCardSkeleton() {
  return (
    <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="w-10 h-10" />
        <SkeletonBlock className="h-3 w-24" />
      </div>
      <SkeletonBlock className="h-8 w-28" />
      <SkeletonBlock className="h-2 w-full" />
    </div>
  );
}

/** Mirrors ZoneCard proportions. */
export function ZoneCardSkeleton() {
  return (
    <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 flex-1">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-3 w-48" />
        </div>
        <SkeletonBlock className="h-6 w-20" />
      </div>
      <div className="flex items-center gap-4">
        <SkeletonBlock className="w-24 h-40" />
        <div className="flex-1 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
      <SkeletonBlock className="h-3 w-full" />
    </div>
  );
}

/** Mirrors an AlertRow / generic wide list row. */
export function RowSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <SkeletonBlock className="w-9 h-9 shrink-0" />
        <div className="space-y-2 flex-1 min-w-0">
          {Array.from({ length: lines }).map((_, i) => (
            <SkeletonBlock
              key={i}
              className={`h-3 ${i === 0 ? "w-2/3" : "w-1/3"}`}
            />
          ))}
        </div>
      </div>
      <SkeletonBlock className="h-9 w-28 shrink-0" />
    </div>
  );
}

/** Mirrors ScheduleCard proportions. */
export function ScheduleCardSkeleton() {
  return (
    <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-5 space-y-4">
      <SkeletonBlock className="h-5 w-32" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-12 w-full" />
        ))}
      </div>
      <SkeletonBlock className="h-7 w-full" />
      <SkeletonBlock className="h-11 w-full" />
    </div>
  );
}
