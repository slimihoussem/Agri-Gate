"use client";

import React from "react";
import { AlertCircle, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

interface MoistureGaugeProps {
  value: number | null | undefined;
  target?: number;
  size?: "sm" | "md" | "lg";
  showTargetMarker?: boolean;
  className?: string;
}

export function MoistureGauge({
  value,
  target = 50,
  size = "md",
  showTargetMarker = true,
  className = "",
}: MoistureGaugeProps) {
  const t = useTranslations("moistureGauge");
  const isDisconnected = value === null || value === undefined;

  // Sizing definitions
  const dimensions = {
    sm: { width: "w-14", height: "h-36", text: "text-base", subtext: "text-[10px]" },
    md: { width: "w-20", height: "h-48", text: "text-xl", subtext: "text-xs" },
    lg: { width: "w-28", height: "h-64", text: "text-2xl", subtext: "text-sm" },
  }[size];

  // If node has no data / is disconnected
  if (isDisconnected) {
    return (
      <div
        className={`relative ${dimensions.width} ${dimensions.height} rounded-2xl bg-soil-800/80 border-2 border-dashed border-soil-600 flex flex-col items-center justify-center p-2 text-center select-none shadow-inner ${className}`}
        role="meter"
        aria-valuenow={undefined}
        aria-valuetext={t("noData")}
        aria-label={t("disconnectedAria")}
      >
        <WifiOff className="w-6 h-6 text-clay-400 mb-1" />
        <span className="font-mono font-bold text-xs text-clay-400">{t("noDataBadge")}</span>
        <span className="text-[10px] text-parchment/50 font-sans mt-0.5 leading-tight">
          {t("offline")}
        </span>
      </div>
    );
  }

  // Value is real reading
  const clampedValue = Math.max(0, Math.min(100, value));
  
  // Threshold color logic
  let colorTheme = {
    bar: "bg-gradient-to-t from-olive-600 to-olive-500",
    border: "border-olive-400/60",
    text: "text-olive-400",
    glow: "shadow-[0_0_15px_rgba(107,142,78,0.25)]",
    statusText: t("optimal"),
  };

  if (clampedValue < target - 20) {
    colorTheme = {
      bar: "bg-gradient-to-t from-clay-600 to-clay-500",
      border: "border-clay-400/60",
      text: "text-clay-400",
      glow: "shadow-[0_0_15px_rgba(193,68,14,0.3)]",
      statusText: t("critical"),
    };
  } else if (clampedValue < target - 10) {
    colorTheme = {
      bar: "bg-gradient-to-t from-wheat-600 to-wheat-500",
      border: "border-wheat-400/60",
      text: "text-wheat-400",
      glow: "shadow-[0_0_15px_rgba(212,166,74,0.25)]",
      statusText: t("warning"),
    };
  }

  return (
    <div
      className={`relative ${dimensions.width} ${dimensions.height} rounded-2xl bg-soil-950 border-2 border-soil-700 overflow-hidden flex flex-col justify-end p-1 shadow-inner group transition-all duration-300 hover:border-soil-600 ${colorTheme.glow} ${className}`}
      role="meter"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t("valueAria", { value: clampedValue, target })}
    >
      {/* Background Soil Depth Reference Markers */}
      <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none opacity-20">
        <div className="border-b border-parchment/40 w-full" />
        <div className="border-b border-parchment/40 w-full" />
        <div className="border-b border-parchment/40 w-full" />
      </div>

      {/* Target Marker Line */}
      {showTargetMarker && (
        <div
          className="absolute left-0 right-0 z-10 flex items-center transition-all pointer-events-none"
          style={{ bottom: `${Math.min(95, Math.max(5, target))}%` }}
        >
          <div className="h-[2px] w-full bg-wheat-400/80 shadow-sm" />
          <span className="absolute right-1 text-[9px] font-mono font-bold text-wheat-400 bg-soil-950/90 px-1 py-0.2 rounded border border-wheat-400/30">
            T:{target}%
          </span>
        </div>
      )}

      {/* Moisture Fill Bar with Soil-Strata Texture */}
      <div
        className={`w-full rounded-xl transition-[height] duration-700 ease-out relative overflow-hidden ${colorTheme.bar} ${colorTheme.border}`}
        style={{ height: `${clampedValue}%` }}
      >
        {/* Subtle Strata layered bands */}
        <div className="absolute inset-0 strata-pattern opacity-40 mix-blend-overlay" />
        
        {/* Water surface glint */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-parchment/30 rounded-t-xl" />
      </div>

      {/* Value Overlay Text Container */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20 px-1">
        <div className="bg-soil-950/85 backdrop-blur-sm px-2 py-1 rounded-lg border border-soil-700/80 text-center shadow-lg">
          <div className={`font-mono font-bold tracking-tight text-parchment ${dimensions.text}`}>
            {clampedValue}
            <span className="text-xs ml-0.5 text-parchment/60">%</span>
          </div>
          <div className={`font-mono text-[9px] uppercase tracking-wider font-semibold ${colorTheme.text}`}>
            {colorTheme.statusText}
          </div>
        </div>
      </div>
    </div>
  );
}
