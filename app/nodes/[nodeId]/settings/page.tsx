"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, SlidersHorizontal, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  getNode,
  getNodeSettings,
  updateNodeSetting,
  resetNodeSetting,
  canManageInfrastructure,
  type AuthUser,
  type EffectiveThresholds,
} from "@/lib/api";
import type { SensorNode } from "@/lib/types";
import { useAuth } from "@/lib/hooks/useAuth";
import { SkeletonBlock } from "@/components/Skeleton";
import { useTranslations } from "next-intl";

/**
 * Per-node alert thresholds (Part 13 UI).
 * Mirrors the farm settings page layout exactly; every field shows its
 * EFFECTIVE value with a source label (DEFAULT / FARM / CUSTOM), and CUSTOM
 * fields carry a "Reset to farm value" link.
 */

const FIELDS: { key: string; label: string; unit: string }[] = [
  { key: "moistureLow", label: "Soil moisture — low alert", unit: "%" },
  { key: "moistureHigh", label: "Soil moisture — high alert", unit: "%" },
  { key: "batteryLow", label: "Node battery — low warning", unit: "%" },
  { key: "batteryCritical", label: "Node battery — critical", unit: "%" },
  { key: "nitrogenLow", label: "Nitrogen — low threshold", unit: "ppm" },
  { key: "phosphorusLow", label: "Phosphorus — low threshold", unit: "ppm" },
  { key: "potassiumLow", label: "Potassium — low threshold", unit: "ppm" },
  { key: "soilTempLowExtreme", label: "Soil temp — extreme low", unit: "°C" },
  { key: "soilTempHighExtreme", label: "Soil temp — extreme high", unit: "°C" },
  { key: "offlineMinutes", label: "Node silence → offline flag", unit: "min" },
  { key: "irrigationMaxRunningMinutes", label: "Irrigation max run → long-running warning", unit: "min" },
];

export default function NodeSettingsPage({
  params,
}: {
  params: { nodeId: string };
}) {
  const t = useTranslations("pageHeadings");
  const { user } = useAuth();
  const router = useRouter();
  const [node, setNode] = useState<SensorNode | null>(null);
  const [effective, setEffective] = useState<EffectiveThresholds | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const canEdit = canManageInfrastructure(user);

  const reload = useCallback(async (): Promise<void> => {
    const [n, eff] = await Promise.all([
      getNode(params.nodeId),
      getNodeSettings(params.nodeId),
    ]);
    setNode(n);
    setEffective(eff);
    setValues({ ...eff.values });
  }, [params.nodeId]);

  useEffect(() => {
    reload().catch((err) => setBanner({ ok: false, text: (err as Error).message }));
  }, [reload]);

  // Only fields the operator actually changed get PATCHed.
  const changedKeys = useMemo(() => {
    if (!effective) return [];
    return FIELDS.filter((f) => values[f.key] !== effective.values[f.key]).map((f) => f.key);
  }, [values, effective]);

  const handleSave = async (): Promise<void> => {
    if (!node || changedKeys.length === 0) return;
    setSaving(true);
    try {
      for (const key of changedKeys) {
        await updateNodeSetting(params.nodeId, key, values[key]);
      }
      await reload();
      setBanner({ ok: true, text: `Saved ${changedKeys.length} override(s) — effective from the next evaluated reading.` });
      setTimeout(() => setBanner(null), 6000);
    } catch (err) {
      setBanner({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Back — return to wherever this was opened from (zone grid via the
          node modal, or the farm/devices list). Falls back to the node's
          zone grid when there is no prior history, and never targets the
          removed /irrigation/{zoneId}/{nodeId} route. */}
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) {
            router.back();
          } else {
            router.push(node?.zoneId ? `/irrigation/${node.zoneId}` : "/irrigation");
          }
        }}
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-mono text-parchment/60 hover:text-olive-400 hover:bg-soil-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {node?.name ?? "node"}
      </button>

      {/* Header */}
      <div className="border-b border-soil-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment flex items-center gap-3">
          <SlidersHorizontal className="w-7 h-7 text-olive-400" />
          <span>{node ? `${node.name} — Alert Thresholds` : "Alert Thresholds"}</span>
        </h1>
        <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
          Per-node values — overrides replace farm settings, which replace platform defaults
        </p>
      </div>

      {banner && (
        <div
          role="status"
          className={`p-3 rounded-lg text-xs font-mono font-medium flex items-center gap-2 ${
            banner.ok
              ? "bg-olive-600/15 border border-olive-500/40 text-olive-400"
              : "bg-clay-500/10 border border-clay-500/40 text-clay-400"
          }`}
        >
          {banner.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {!canEdit && (
        <div className="p-3 rounded-lg bg-soil-900 border border-soil-800 text-[11px] font-mono text-parchment/50 inline-flex items-center gap-2">
          Read-only · technician+
        </div>
      )}

      {/* Threshold grid — same layout as farm settings */}
      <section aria-label="Node alert thresholds" className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-5 shadow-lg">
        {!effective ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-[74px]" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FIELDS.map(({ key, label, unit }) => {
                const overridden = effective.sources[key] === "node";
                return (
                  <label key={key} className="space-y-1.5 block">
                    <span
                      className={`text-[11px] font-mono uppercase tracking-wider flex items-center justify-between gap-2 ${
                        overridden ? "text-parchment font-bold" : "text-parchment/70"
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      <SourceLabel source={effective.sources[key]} />
                    </span>
                    <input
                      type="number"
                      disabled={!canEdit}
                      value={Number.isFinite(values[key]) ? values[key] : ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                      className={`w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border font-mono text-sm focus:outline-none transition-colors ${
                        overridden
                          ? "border-clay-500/40 text-parchment focus:border-clay-400"
                          : "border-soil-700 text-parchment focus:border-olive-400"
                      } ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                    />
                    <span className="block text-[10px] text-parchment/40">
                      {unit}
                      {overridden && (
                        <button
                          type="button"
                          onClick={() => void resetKey(key)}
                          className="ml-2 underline hover:text-wheat-400"
                        >
                          Reset to farm value
                        </button>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-[11px] font-sans text-parchment/40">
                {changedKeys.length > 0
                  ? `${changedKeys.length} field(s) modified`
                  : "No changes yet"}
              </p>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !canEdit || changedKeys.length === 0}
                className="min-h-[48px] px-6 py-2.5 rounded-lg bg-olive-500 hover:bg-olive-600 active:bg-olive-700 text-soil-950 font-mono font-bold text-sm flex items-center gap-2 shadow-md disabled:opacity-60 disabled:hover:bg-olive-500"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Save className="w-4 h-4 stroke-[2.5]" />
                )}
                Save Settings
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );

  async function resetKey(key: string): Promise<void> {
    try {
      const eff = await resetNodeSetting(params.nodeId, key);
      setEffective(eff);
      setValues((prev) => ({ ...prev, [key]: eff.values[key] }));
      setBanner({ ok: true, text: `${key} reverted to inherited value.` });
      setTimeout(() => setBanner(null), 4000);
    } catch (err) {
      setBanner({ ok: false, text: (err as Error).message });
    }
  }
}

function SourceLabel({ source }: { source: "default" | "farm" | "node" }) {
  const map = {
    node: { text: "CUSTOM", cls: "bg-clay-600/20 text-clay-400 border-clay-500/40" },
    farm: { text: "FARM", cls: "bg-wheat-600/15 text-wheat-400/90 border-wheat-500/30" },
    default: { text: "DEFAULT", cls: "bg-soil-950 text-parchment/35 border-soil-800" },
  } as const;
  const meta = map[source];
  return (
    <span className={`px-1.5 py-px rounded text-[9px] font-bold normal-case border ${meta.cls}`}>
      {meta.text}
    </span>
  );
}

// Keep AuthUser referenced for parity with other pages' prop typing patterns.
export type PageUser = AuthUser;
