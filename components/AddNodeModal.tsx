"use client";

import React, { useEffect, useState } from "react";
import { Zone } from "@/lib/types";
import { X, Plus, Cpu, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

interface AddNodeModalProps {
  isOpen: boolean;
  zones: Zone[];
  /** Part 14: "edit" pre-fills from `initial` and PATCHes instead of POSTing. */
  mode?: "create" | "edit";
  initial?: {
    id?: string;
    name?: string;
    zoneId?: string | null;
    commMethod?: string;
    mqttClientId?: string | null;
    readIntervalMs?: number | null;
    isActuator?: boolean;
    lat?: number | null;
    lon?: number | null;
    sensorCapabilities?: string[];
    flowRateLPerMin?: number | null;
    maxRuntimeMinutes?: number | null;
    installedAt?: string | null;
    notes?: string | null;
    active?: boolean;
  } | null;
  /** Real API submission — resolves on success, throws ApiError on failure. */
  onSubmit: (input: {
    name: string;
    zoneId: string | null;
    commMethod: string;
    mqttClientId?: string;
    read_interval_ms: number | null;
    isActuator: boolean;
    lat?: number;
    lon?: number;
    sensorCapabilities: string[];
    flowRateLPerMin?: number;
    maxRuntimeMinutes?: number;
    installedAt?: string;
    notes?: string;
  }) => Promise<void>;
  onClose: () => void;
}

export function AddNodeModal({
  isOpen,
  zones,
  initial,
  mode = "create",
  onSubmit,
  onClose,
}: AddNodeModalProps) {
  const t = useTranslations("addNodeModal");
  const tCommon = useTranslations("common");
  const [nodeName, setNodeName] = useState("");
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? "");
  const [commMethod, setCommMethod] = useState<"wifi">("wifi");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Part 13 ext: extended configuration state
  const CAPS = ["soilMoisture", "nitrogen", "phosphorus", "potassium", "soilTemp", "airTemp", "airHumidity"] as const;
  const [caps, setCaps] = useState<string[]>(["soilMoisture"]);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [isActuator, setIsActuator] = useState(false);
  const [flowRate, setFlowRate] = useState("");
  const [maxRuntime, setMaxRuntime] = useState("60");
  const [installedAt, setInstalledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [mqttClientId, setMqttClientId] = useState("");
  const [readInterval, setReadInterval] = useState("");

  // Pre-fill when opened (edit mode pulls the node's current config).
  useEffect(() => {
    if (!isOpen) return;
    if (mode === "edit" && initial) {
      setNodeName(initial.name ?? "");
      setZoneId(initial.zoneId ?? zones[0]?.id ?? "");
      setIsActuator(initial.isActuator === true);
      setCaps(
        initial.sensorCapabilities && initial.sensorCapabilities.length > 0
          ? initial.sensorCapabilities
          : ["soilMoisture"]
      );
      setLat(initial.lat != null ? String(initial.lat) : "");
      setLon(initial.lon != null ? String(initial.lon) : "");
      setFlowRate(initial.flowRateLPerMin != null ? String(initial.flowRateLPerMin) : "");
      setMaxRuntime(initial.maxRuntimeMinutes != null ? String(initial.maxRuntimeMinutes) : "60");
      setInstalledAt(initial.installedAt ? initial.installedAt.slice(0, 10) : "");
      setNotes(initial.notes ?? "");
      setMqttClientId(initial.mqttClientId ?? "");
      setReadInterval(initial.readIntervalMs != null ? String(initial.readIntervalMs) : "");
    } else if (mode === "create") {
      setNodeName(""); setZoneId(zones[0]?.id ?? ""); setCommMethod("wifi");
      setCaps(["soilMoisture"]); setLat(""); setLon(""); setIsActuator(false);
      setFlowRate(""); setMaxRuntime("60"); setInstalledAt(""); setNotes("");
      setMqttClientId(""); setReadInterval("");
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, initial?.id]);

  // Escape closes the dialog — same behavior as X / Cancel / overlay click.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!nodeName.trim()) {
      setError(t("errName"));
      return;
    }
    if (caps.length === 0) {
      setError(t("errCaps"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        name: nodeName.trim(),
        zoneId: zoneId || null,
        commMethod,
        mqttClientId: mqttClientId || undefined,
        read_interval_ms: readInterval === "" ? null : Number(readInterval),
        lat: lat === "" ? undefined : Number(lat),
        lon: lon === "" ? undefined : Number(lon),
        sensorCapabilities: caps,
        flowRateLPerMin: isActuator && flowRate !== "" ? Number(flowRate) : undefined,
        maxRuntimeMinutes: isActuator && maxRuntime !== "" ? Number(maxRuntime) : undefined,
        installedAt: installedAt || undefined,
        notes: notes || undefined,
        isActuator,
      });
      // Success → parent closes modal + refetches. Reset local form state.
      setNodeName("");
      setCaps(["soilMoisture"]);
      setLat(""); setLon(""); setIsActuator(false);
      setFlowRate(""); setMaxRuntime("60"); setInstalledAt(""); setNotes("");
      setMqttClientId(""); setReadInterval("");
      setZoneId(zones[0]?.id ?? "");
    } catch (err) {
      setError((err as Error).message || t("errSave"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-soil-900 border-2 border-soil-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — pinned (flex-none), title + close X never scroll out of view */}
        <div className="flex items-center justify-between gap-3 border-b border-soil-800 px-6 pt-5 pb-3 flex-none bg-soil-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-soil-800 border border-soil-700 text-olive-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h2 id="modal-title" className="text-xl font-display font-bold text-parchment">
                {mode === "edit" ? t("editTitle") : t("createTitle")}
              </h2>
              <p className="text-xs text-parchment/60 font-sans">
                {mode === "edit" ? t("editSub", { id: initial?.id ?? "node" }) : t("createSub")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeAria")}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg text-parchment/60 hover:text-parchment hover:bg-soil-800 border border-transparent hover:border-soil-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body — flex-1 + overflow-y-auto; header/footer stay pinned above/below */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-soil-900">
          {error && (
            <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/30 text-clay-400 text-xs font-mono font-medium">
              {error}
            </div>
          )}

          {/* Form */}
          <form id="node-form" onSubmit={handleSubmit} className="space-y-4">

          {/* Node Name */}
          <div className="space-y-1.5">
            <label htmlFor="node-name" className="text-xs font-mono uppercase tracking-wider text-parchment/80">
              {t("nodeNameLabel")}
            </label>
            <input
              id="node-name"
              type="text"
              required
              placeholder={t("nodeNamePlaceholder")}
              value={nodeName}
              onChange={(e) => {
                setNodeName(e.target.value);
                if (error) setError("");
              }}
              className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400 font-sans"
            />
          </div>

          {/* Zone Dropdown */}
          <div className="space-y-1.5">
            <label htmlFor="node-zone" className="text-xs font-mono uppercase tracking-wider text-parchment/80">
              {t("zoneLabel")}
            </label>
            <select
              id="node-zone"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400 font-sans cursor-pointer"
            >
              {zones.length === 0 && <option value="">{t("loadingZones")}</option>}
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </div>

          {/* Communication Protocol */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-wider text-parchment/80">
              {t("commLabel")}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`min-h-[48px] p-3 rounded-lg border flex items-center gap-2.5 cursor-pointer text-xs font-mono ${
                  commMethod === "wifi"
                    ? "bg-olive-600/20 border-olive-500/50 text-olive-400 font-bold"
                    : "bg-soil-950 border-soil-700 text-parchment/60"
                }`}
              >
                <input
                  type="radio"
                  name="comm"
                  value="wifi"
                  checked={commMethod === "wifi"}
                  onChange={() => setCommMethod("wifi")}
                  className="hidden"
                />
                <Radio className="w-4 h-4 text-olive-400" />
                <span>{t("wifi")}</span>
              </label>

              <div
                className="min-h-[48px] p-3 rounded-lg border border-soil-800 bg-soil-950/40 text-parchment/30 flex items-center gap-2.5 text-xs font-mono select-none"
                title={t("loraTitle")}
              >
                <Radio className="w-4 h-4 opacity-40" />
                <span>{t("loraSoon")}</span>
              </div>
            </div>
          </div>

          {/* MQTT Client ID + Read Interval (Part 14 edit fields) */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("mqttLabel")}</span>
              <input
                value={mqttClientId}
                onChange={(e) => setMqttClientId(e.target.value)}
                placeholder={t("mqttPlaceholder")}
                className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-xs font-mono focus:outline-none focus:border-olive-400"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("readIntervalLabel")}</span>
              <input
                type="number" min={1000} step={1000}
                placeholder={t("readIntervalPlaceholder")}
                value={readInterval}
                onChange={(e) => setReadInterval(e.target.value)}
                className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-mono focus:outline-none focus:border-olive-400"
              />
            </label>
          </div>

          {/* ── Part 13 ext: extended configuration ── */}
          <div className="space-y-4 pt-3 border-t border-soil-800">
            <span className="text-xs font-mono uppercase tracking-wider text-parchment/70">{t("configHeading")}</span>

            {/* GPS */}
            <div className="grid grid-cols-2 gap-3">
              <input type="number" step="any" placeholder={t("latPlaceholder")} value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-mono focus:outline-none focus:border-olive-400" />
              <input type="number" step="any" placeholder={t("lonPlaceholder")} value={lon}
                onChange={(e) => setLon(e.target.value)}
                className="min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-mono focus:outline-none focus:border-olive-400" />
            </div>

            {/* Sensor capabilities checkboxes */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-wider text-parchment/80">{t("capsHeading")}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {CAPS.map((cap) => (
                  <label key={cap} className={`min-h-[40px] px-2.5 rounded-lg border flex items-center gap-2 cursor-pointer text-[11px] font-mono ${caps.includes(cap) ? "bg-olive-600/15 border-olive-500/40 text-olive-400" : "bg-soil-950 border-soil-700 text-parchment/60"}`}>
                    <input type="checkbox" checked={caps.includes(cap)} className="hidden"
                      onChange={() => setCaps((p) => (p.includes(cap) ? p.filter((c) => c !== cap) : [...p, cap]))} />
                    <span>{t(`cap.${cap}`)}</span>
                  </label>
                ))}
              </div>
              {caps.length === 0 && (
                <p className="text-[10px] font-mono text-clay-400">{t("capsRequired")}</p>
              )}
            </div>

            {/* Actuator toggle + gated fields */}
            <label className="flex items-center gap-2.5 min-h-[44px] cursor-pointer">
              <input type="checkbox" checked={isActuator} onChange={(e) => setIsActuator(e.target.checked)} className="w-4 h-4 accent-olive-500" />
              <span className="text-xs font-sans text-parchment">{t("actuatorLabel")}</span>
            </label>
            {isActuator && (
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="any" min="0" placeholder={t("flowRatePlaceholder")} value={flowRate}
                  onChange={(e) => setFlowRate(e.target.value)}
                  className="min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-mono focus:outline-none focus:border-olive-400" />
                <input type="number" min="1" placeholder={t("maxRuntimePlaceholder")} value={maxRuntime}
                  onChange={(e) => setMaxRuntime(e.target.value)}
                  className="min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-mono focus:outline-none focus:border-olive-400" />
              </div>
            )}

            {/* Install metadata */}
            <div className="grid grid-cols-1 gap-3">
              <label className="space-y-1 block">
                <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("installedAtLabel")}</span>
                <input type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)}
                  className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-mono focus:outline-none focus:border-olive-400" />
              </label>
              <label className="space-y-1 block">
                <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("notesLabel")}</span>
                <textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm font-sans focus:outline-none focus:border-olive-400 resize-none" />
              </label>
            </div>
          </div>

          </form>
        </div>

        {/* Footer — pinned (flex-none), Cancel/Register always visible */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 px-6 py-4 border-t border-soil-800 flex-none bg-soil-900">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full sm:w-auto min-h-[48px] px-5 py-2.5 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-medium transition-colors text-sm disabled:opacity-50"
          >
            {tCommon("cancel")}
          </button>
          <button
            type="submit"
            form="node-form"
            disabled={submitting || zones.length === 0}
            className="w-full sm:w-auto min-h-[48px] px-6 py-2.5 rounded-lg bg-olive-500 hover:bg-olive-600 active:bg-olive-700 text-soil-950 font-mono font-bold flex items-center justify-center gap-2 transition-all shadow-md text-sm disabled:opacity-50 disabled:hover:bg-olive-500"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-soil-950/30 border-t-soil-950 rounded-full animate-spin motion-reduce:animate-none" />
                <span>{mode === "edit" ? t("saving") : t("registering")}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>{mode === "edit" ? t("saveChanges") : t("deployNode")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
