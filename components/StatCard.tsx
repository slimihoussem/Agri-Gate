"use client";

import React from "react";
import { LucideIcon, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export interface TrendInfo {
  value: string | number;
  direction: "up" | "down" | "neutral";
  isGood?: boolean; // If true, up is green; if false, up might be clay (e.g. rising stress)
  periodLabel?: string;
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  trend?: TrendInfo; // ONLY rendered if previous-period data exists
  subtext?: string;
  statusColor?: "olive" | "wheat" | "clay" | "soil";
  className?: string;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  trend,
  subtext,
  statusColor = "soil",
  className = "",
}: StatCardProps) {
  const getIconColor = () => {
    switch (statusColor) {
      case "olive":
        return "text-olive-400 bg-olive-500/10 border-olive-500/30";
      case "wheat":
        return "text-wheat-400 bg-wheat-500/10 border-wheat-500/30";
      case "clay":
        return "text-clay-400 bg-clay-500/10 border-clay-500/30";
      default:
        return "text-parchment/80 bg-soil-800 border-soil-700";
    }
  };

  const renderTrend = () => {
    if (!trend) return null;

    const isPositive = trend.direction === "up";
    const isNeutral = trend.direction === "neutral";

    // Standard agricultural context: usually if isGood is true, up is olive; if isGood is false, down might be olive
    const isGoodTrend = trend.isGood ?? isPositive;

    const trendColor = isNeutral
      ? "text-parchment/60 bg-soil-800 border-soil-700"
      : isGoodTrend
      ? "text-olive-400 bg-olive-500/10 border-olive-500/30"
      : "text-clay-400 bg-clay-500/10 border-clay-500/30";

    const TrendIcon = isNeutral ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;

    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium border ${trendColor}`}
        title={`Comparison vs previous period: ${trend.value}`}
      >
        <TrendIcon className="w-3.5 h-3.5 stroke-[2.5]" />
        <span>{trend.value}</span>
        {trend.periodLabel && (
          <span className="text-[10px] opacity-75 font-sans ml-0.5">
            {trend.periodLabel}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className={`bg-soil-900 border-2 border-soil-700 rounded-xl p-5 shadow-lg flex flex-col justify-between gap-4 transition-all hover:border-soil-600 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs sm:text-sm font-sans font-medium text-parchment/70 uppercase tracking-wider">
          {label}
        </span>
        <div className={`p-2 rounded-lg border ${getIconColor()} shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-2xl sm:text-3xl font-mono font-bold text-parchment tracking-tight">
            {value}
          </span>
          {unit && (
            <span className="text-sm font-mono font-medium text-parchment/60">
              {unit}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap min-h-[22px]">
          {renderTrend()}
          {subtext && (
            <span className="text-xs font-sans text-parchment/50">
              {subtext}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
