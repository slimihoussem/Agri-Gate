"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ZoneTrendSeries } from "@/lib/types";
import { formatClock } from "@/lib/format";
import { Activity, Info, LineChart as LineChartIcon } from "lucide-react";

/**
 * Consumes the GENERIC trend shape from GET /api/farms/:id/telemetry/trend:
 *   { zones: [{ zoneId, zoneName, points: [{ time, avgMoisture }] }] }
 * One <Line> per zone is rendered dynamically — zone count is never assumed.
 */
interface MoistureTrendChartProps {
  zones: ZoneTrendSeries[];
  className?: string;
}

/** Rotating palette — olive/wheat/clay first so small farms keep brand hues. */
const PALETTE = ["#8BAE6E", "#E4C173", "#E0714A", "#7FA8C9", "#C99FC9", "#8FC9B4"];

export function MoistureTrendChart({ zones, className = "" }: MoistureTrendChartProps) {
  const t = useTranslations("moistureTrendChart");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full h-80 bg-soil-900 border-2 border-soil-700 rounded-xl flex items-center justify-center text-parchment/50 font-mono text-sm">
        {t("loading")}
      </div>
    );
  }

  // Union all bucket timestamps, then spread each zone's values across rows.
  const times = Array.from(new Set(zones.flatMap((z) => z.points.map((p) => p.time)))).sort();
  const data = times.map((time) => {
    const row: Record<string, string | number> = { time: formatClock(time) };
    for (const zone of zones) {
      const point = zone.points.find((p) => p.time === time);
      if (point !== undefined) row[zone.zoneName] = point.avgMoisture;
    }
    return row;
  });

  const totalPoints = zones.reduce((sum, z) => sum + z.points.length, 0);
  const disconnectedZones = zones.filter((z) => z.points.length === 0);

  return (
    <div className={`bg-soil-900 border-2 border-soil-700 rounded-xl p-5 shadow-xl space-y-4 ${className}`}>
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-soil-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-soil-800 border border-soil-700 text-olive-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-parchment">
                {t("title")}
              </h2>
              <p className="text-xs text-parchment/60 font-sans">
                {t("subtitle", { count: zones.length })}
              </p>
          </div>
        </div>

        {disconnectedZones.length > 0 && (
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-soil-950 border border-clay-500/30 text-clay-400 text-xs font-mono"
            role="status"
          >
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>
              {t("noDataZone", { zones: disconnectedZones.map((z) => z.zoneName.split("•")[0].trim()).join(", ") })}
            </span>
          </div>
        )}
      </div>

      {totalPoints === 0 ? (
        /* Empty successful response ≠ error: say so plainly */
        <div className="h-72 w-full flex flex-col items-center justify-center gap-3 text-parchment/50">
          <LineChartIcon className="w-10 h-10 opacity-40" />
          <p className="font-mono text-sm">{t("emptyTitle")}</p>
          <p className="text-xs font-sans text-parchment/40 max-w-sm text-center">
            {t("emptySub")}
          </p>
        </div>
      ) : (
        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#332C23" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#A89E90"
                tick={{ fill: "#A89E90", fontSize: 11, fontFamily: "var(--font-plex-mono), monospace" }}
                tickLine={{ stroke: "#332C23" }}
                axisLine={{ stroke: "#332C23" }}
              />
              <YAxis
                domain={["auto", "auto"]}
                stroke="#A89E90"
                tick={{ fill: "#A89E90", fontSize: 11, fontFamily: "var(--font-plex-mono), monospace" }}
                tickLine={{ stroke: "#332C23" }}
                axisLine={{ stroke: "#332C23" }}
                unit="%"
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{
                  paddingTop: "12px",
                  fontFamily: "var(--font-plex-mono), monospace",
                  fontSize: "12px",
                }}
              />

              {/* One dynamic line per zone — colors rotate through the palette */}
              {zones.map((zone, index) => (
                <Line
                  key={zone.zoneId}
                  type="monotone"
                  dataKey={zone.zoneName}
                  name={zone.zoneName}
                  stroke={PALETTE[index % PALETTE.length]}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{
                    r: 6,
                    fill: PALETTE[index % PALETTE.length],
                    stroke: "#14120F",
                    strokeWidth: 2,
                  }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Field Note */}
      <div className="pt-2 flex items-center gap-2 text-xs text-parchment/50 font-sans">
        <Info className="w-3.5 h-3.5 text-olive-400 shrink-0" />
        <span>
          {t("fieldNote")}
        </span>
      </div>
    </div>
  );
}

// Custom high-contrast dark tooltip
function CustomTooltip({ active, payload, label }: any) {
  const t = useTranslations("moistureTrendChart");
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-soil-950/95 border-2 border-soil-700 rounded-xl p-3.5 shadow-2xl space-y-2 backdrop-blur-md">
      <div className="text-xs font-mono font-bold text-parchment border-b border-soil-800 pb-1 flex items-center justify-between gap-4">
        <span>{t("tooltipTime")}: {label}</span>
        <span className="text-[10px] text-parchment/50">{t("tooltipHistory")}</span>
      </div>

      <div className="space-y-1.5 font-mono text-xs">
        {payload.map((entry: any, index: number) => {
          const val = entry.value;
          return (
            <div key={index} className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-parchment/80 font-medium">{entry.name}:</span>
              </div>
              <span className="font-bold text-parchment">
                {val !== null && val !== undefined ? (
                  `${val}%`
                ) : (
                  <span className="text-clay-400 font-bold">{t("noDataValue")}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
