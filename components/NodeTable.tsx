"use client";

import React, { useState } from "react";
import { SensorNode } from "@/lib/types";
import {
  Battery,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  ChevronRight,
  Pencil,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { timeAgo } from "@/lib/format";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Radio,
  Wifi
} from "lucide-react";
import { useTranslations } from "next-intl";

type SortKey = "status" | "name" | "zone" | "battery" | "rssi" | "lastSeen";
type SortDirection = "asc" | "desc";

interface NodeTableProps {
  nodes: SensorNode[];
  onSelectNode: (node: SensorNode) => void;
  initialSortKey?: SortKey;
  initialSortDir?: SortDirection;
  /** Part 14: technician-only row actions (UI gate only — API enforces). */
  onEditNode?: (node: SensorNode) => void;
  onRemoveNode?: (node: SensorNode) => void;
  onReactivateNode?: (node: SensorNode) => void;
}

export function NodeTable({
  nodes,
  onSelectNode,
  initialSortKey = "status",
  initialSortDir = "desc", // Default offline first
  onEditNode,
  onRemoveNode,
  onReactivateNode,
}: NodeTableProps) {
  const t = useTranslations("nodeTable");
  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDirection>(initialSortDir);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const getSortedNodes = () => {
    return [...nodes].sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case "status": {
          // Status order priority: offline (0), warning (1), online (2)
          const rank = { offline: 0, warning: 1, online: 2 };
          comparison = rank[a.status] - rank[b.status];
          break;
        }
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "zone":
          comparison = (a.zoneName || a.zoneId || "").localeCompare(b.zoneName || b.zoneId || "");
          break;
        case "battery":
          comparison = (a.battery ?? -1) - (b.battery ?? -1);
          break;
        case "rssi":
          comparison = (a.rssi ?? 0) - (b.rssi ?? 0);
          break;
        case "lastSeen":
          comparison = (a.lastSeen ?? "").localeCompare(b.lastSeen ?? "");
          break;
      }
      return sortDir === "asc" ? comparison : -comparison;
    });
  };

  const sortedNodes = getSortedNodes();

  const getStatusBadge = (status: SensorNode["status"]) => {
    switch (status) {
      case "online":
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-olive-400" />,
          label: t("statusOnline"),
          style: "bg-olive-600/20 text-olive-400 border-olive-500/40",
        };
      case "warning":
        return {
          icon: <AlertTriangle className="w-4 h-4 text-wheat-400" />,
          label: t("statusWarning"),
          style: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40",
        };
      case "offline":
      default:
        return {
          icon: <WifiOff className="w-4 h-4 text-clay-400" />,
          label: t("statusOffline"),
          style: "bg-clay-600/20 text-clay-400 border-clay-500/40",
        };
    }
  };

  const getBatteryRender = (battery: number | null) => {
    if (battery === null) {
      return (
        <div className="flex items-center gap-2 font-mono text-parchment/40" title="No battery telemetry received yet">
          <BatteryWarning className="w-4 h-4" />
          <span className="font-semibold">—</span>
        </div>
      );
    }
    const Icon =
      battery > 75
        ? Battery
        : battery > 40
        ? BatteryMedium
        : battery > 20
        ? BatteryLow
        : BatteryWarning;

    const color =
      battery > 40
        ? "text-olive-400"
        : battery > 20
        ? "text-wheat-400"
        : "text-clay-400";

    return (
      <div className="flex items-center gap-2 font-mono">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="font-semibold text-parchment">{battery}%</span>
      </div>
    );
  };

  const getRssiBars = (rssi: number | null) => {
    if (rssi === null) {
      return (
        <div className="flex items-center gap-2 font-mono text-parchment/40" title="No signal reading yet">
          —
        </div>
      );
    }
    // Thresholds at -90 / -80 / -70 / -60 dBm
    let activeBars = 0;
    if (rssi >= -60) activeBars = 4;
    else if (rssi >= -70) activeBars = 3;
    else if (rssi >= -80) activeBars = 2;
    else if (rssi >= -90) activeBars = 1;

    return (
      <div className="flex items-center gap-2 font-mono">
        <div className="flex items-end gap-0.5 h-3.5">
          {[1, 2, 3, 4].map((bar) => (
            <div
              key={bar}
              className={`w-1.5 rounded-t-xs ${
                bar <= activeBars
                  ? activeBars <= 1
                    ? "bg-clay-400"
                    : activeBars === 2
                    ? "bg-wheat-400"
                    : "bg-olive-400"
                  : "bg-soil-700"
              }`}
              style={{ height: `${bar * 25}%` }}
            />
          ))}
        </div>
        <span className="text-xs text-parchment/80 font-mono">{rssi} dBm</span>
      </div>
    );
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40 ml-1" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-olive-400 ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-olive-400 ml-1" />
    );
  };

  return (
    <div className="w-full overflow-hidden rounded-xl border-2 border-soil-700 bg-soil-900 shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[650px]">
          <thead>
            <tr className="border-b-2 border-soil-700 bg-soil-950/70 text-xs font-mono uppercase tracking-wider text-parchment/70 select-none">
              <th className="p-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="min-h-[44px] px-2 flex items-center gap-1 font-mono font-bold hover:text-parchment transition-colors"
                >
<span>{t("headStatus")}</span>
                  {renderSortIcon("status")}
                </button>
              </th>

              <th className="p-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="min-h-[44px] px-2 flex items-center gap-1 font-mono font-bold hover:text-parchment transition-colors"
                >
                  <span>{t("headName")}</span>
                  {renderSortIcon("name")}
                </button>
              </th>

              <th className="p-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("zone")}
                  className="min-h-[44px] px-2 flex items-center gap-1 font-mono font-bold hover:text-parchment transition-colors"
                >
                  <span>{t("headZone")}</span>
                  {renderSortIcon("zone")}
                </button>
              </th>

              <th className="p-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("battery")}
                  className="min-h-[44px] px-2 flex items-center gap-1 font-mono font-bold hover:text-parchment transition-colors"
                >
                  <span>{t("headBattery")}</span>
                  {renderSortIcon("battery")}
                </button>
              </th>

              <th className="p-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("rssi")}
                  className="min-h-[44px] px-2 flex items-center gap-1 font-mono font-bold hover:text-parchment transition-colors"
                >
                  <span>{t("headRssi")}</span>
                  {renderSortIcon("rssi")}
                </button>
              </th>

              <th className="p-3.5">
                <button
                  type="button"
                  onClick={() => handleSort("lastSeen")}
                  className="min-h-[44px] px-2 flex items-center gap-1 font-mono font-bold hover:text-parchment transition-colors"
                >
                  <span>{t("headLastSeen")}</span>
                  {renderSortIcon("lastSeen")}
                </button>
              </th>
              <th className="p-3.5 text-right font-mono">{t("headAction")}</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-soil-800 font-sans text-sm">
            {sortedNodes.map((node) => {
              const badge = getStatusBadge(node.status);

              return (
                <tr
                  key={node.id}
                  onClick={() => onSelectNode(node)}
                  className="hover:bg-soil-800/80 cursor-pointer transition-colors group"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectNode(node);
                    }
                  }}
                  aria-label={t("viewAria", { name: node.name })}
                >
                  {/* Status */}
                  <td className="p-3.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-semibold border ${badge.style}`}
                    >
                      {badge.icon}
                      <span>{badge.label}</span>
                    </span>
                  </td>

                  {/* Name / ID */}
                  <td className="p-3.5 whitespace-nowrap">
                    <div className="font-semibold text-parchment group-hover:text-olive-400 transition-colors">
                      {node.name}
                    </div>
                    <div className="text-xs font-mono text-parchment/50">
                      {node.id} • {node.commMethod.toUpperCase()}
                    </div>
                  </td>

                  {/* Zone */}
                  <td className="p-3.5 whitespace-nowrap text-parchment/80 font-medium">
                    {node.zoneName || node.zoneId}
                  </td>

                  {/* Battery */}
                  <td className="p-3.5 whitespace-nowrap">
                    {getBatteryRender(node.battery)}
                  </td>

                  {/* RSSI */}
                  <td className="p-3.5 whitespace-nowrap">
                    {getRssiBars(node.rssi)}
                  </td>

                  {/* Last Seen */}
                  <td
                    className="p-3.5 whitespace-nowrap text-xs font-mono text-parchment/60"
                    title={node.lastSeen ?? undefined}
                  >
                    {timeAgo(node.lastSeen)}
                  </td>

                  {/* Actions (Part 14): edit/remove/reactivate — technician+ */}
                  <td className="p-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {node.active === false ? (
                        onReactivateNode && (
                          <button
                            type="button"
                            title={t("reactivate")}
                            aria-label={t("reactivateAria", { name: node.name })}
                            onClick={(e) => {
                              e.stopPropagation();
                              onReactivateNode(node);
                            }}
                            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-wheat-400 hover:bg-soil-800 transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )
                      ) : (
                        <>
                          {onEditNode && (
                            <button
                              type="button"
                              title={t("editTitle", { name: node.name })}
                              aria-label={t("editTitle", { name: node.name })}
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditNode(node);
                              }}
                              className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-parchment/60 hover:text-olive-400 hover:bg-soil-800 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {onRemoveNode && (
                            <button
                              type="button"
                              title={t("removeTitle", { name: node.name })}
                              aria-label={t("removeTitle", { name: node.name })}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveNode(node);
                              }}
                              className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-parchment/50 hover:text-clay-400 hover:bg-clay-600/10 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                      <div
                        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-parchment/50 group-hover:text-olive-400"
                        title={t("viewDetails")}
                      >
                        <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
