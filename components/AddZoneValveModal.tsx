"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Gauge, Loader2 } from "lucide-react";
import { createNode } from "@/lib/api";
import type { SensorNode } from "@/lib/types";
import { useTranslations } from "next-intl";

/**
 * Part 19: simplified creation form for a zone's dedicated main valve.
 * Only infra facts are collected — name, mqtt client id, flow rate, max
 * runtime. NO sensor capability picker: a zone valve is forced server-side to
 * is_actuator=true and sensor_capabilities=[].
 */
export function AddZoneValveModal({
  farmId,
  zoneId,
  zoneName,
  onClose,
  onCreated,
}: {
  farmId: string;
  zoneId: string;
  zoneName: string;
  onClose: () => void;
  /** Called with the created node so parents can refresh their list. */
  onCreated: (node: SensorNode) => void;
}) {
  const t = useTranslations("addValveModal");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [mqttClientId, setMqttClientId] = useState("");
  const [flowRate, setFlowRate] = useState("");
  const [maxRuntime, setMaxRuntime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createNode({
        farmId,
        zoneId,
        name: name.trim(),
        mqttClientId: mqttClientId.trim() || undefined,
        flowRateLPerMin: flowRate ? Number(flowRate) : undefined,
        maxRuntimeMinutes: maxRuntime ? Number(maxRuntime) : undefined,
        isZoneValve: true,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const fieldCls =
    "w-full min-h-[44px] rounded-lg bg-soil-950 border border-soil-600 focus:border-olive-500 text-parchment px-3 text-sm font-sans outline-none transition-colors";

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-overlay-top)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-valve-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-soil-900 border-2 border-soil-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-soil-800 px-6 pt-5 pb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-soil-800 border border-olive-500/40 text-olive-400">
              <Gauge className="w-6 h-6" />
            </div>
            <div>
              <h2 id="add-valve-title" className="text-xl font-display font-semibold text-parchment">
                {t("title")}
              </h2>
              <p className="text-xs font-mono text-parchment/60 mt-0.5">
                {t("subtitle", { zone: zoneName })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("close")}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg text-parchment/60 hover:text-parchment hover:bg-soil-800 border border-transparent hover:border-soil-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <p className="text-xs font-sans text-parchment/60 leading-relaxed">
            {t("body")}
          </p>

          <div>
            <label htmlFor="zv-name" className="block text-xs font-mono text-parchment/60 uppercase mb-1.5">
              {t("valveName")}
            </label>
            <input
              id="zv-name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("valveNamePlaceholder")}
              className={fieldCls}
            />
          </div>

          <div>
            <label htmlFor="zv-mqtt" className="block text-xs font-mono text-parchment/60 uppercase mb-1.5">
              {t("mqttClientId")}
            </label>
            <input
              id="zv-mqtt"
              value={mqttClientId}
              onChange={(e) => setMqttClientId(e.target.value)}
              placeholder={t("mqttPlaceholder")}
              className={fieldCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="zv-flow" className="block text-xs font-mono text-parchment/60 uppercase mb-1.5">
                {t("flowRate")}
              </label>
              <input
                id="zv-flow"
                type="number"
                min="0"
                step="0.1"
                value={flowRate}
                onChange={(e) => setFlowRate(e.target.value)}
                placeholder={tCommon("optional")}
                className={fieldCls}
              />
            </div>
            <div>
              <label htmlFor="zv-maxrun" className="block text-xs font-mono text-parchment/60 uppercase mb-1.5">
                {t("maxRuntime")}
              </label>
              <input
                id="zv-maxrun"
                type="number"
                min="1"
                step="1"
                value={maxRuntime}
                onChange={(e) => setMaxRuntime(e.target.value)}
                placeholder={tCommon("optional")}
                className={fieldCls}
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-xs font-mono">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-medium transition-colors text-sm"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-lg bg-olive-500 hover:bg-olive-600 disabled:opacity-60 text-soil-950 border border-olive-400 font-semibold flex items-center justify-center gap-2 transition-all shadow-md text-sm"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
              {busy ? tCommon("creating") : t("createValve")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}