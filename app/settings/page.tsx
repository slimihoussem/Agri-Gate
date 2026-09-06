"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Save,
  SlidersHorizontal,
  Users as UsersIcon,
  Building2,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  ChevronDown,
  ChevronRight,
  Pencil,
  MapPin,
  Archive,
  Layers,
} from "lucide-react";
import {
  getFarmSettings,
  updateFarmSettings,
  updateFarm,
  createNewOrgWithFarm,
  addFarmToExistingOrg,
  getAdminOrgs,
  getAdminFarmUsers,
  adminCreateUser,
  adminUpdateUser,
  adminDeactivateUser,
  adminUpdateFarm,
  adminDeleteFarm,
  adminDeleteOrg,
  getZones,
  createZone,
  updateZone,
  deleteZone,
  getFarmSpatial,
  canEditSpatial,
  type AuthUser,
  type AdminOrg,
  type OrgFarmStats,
  ApiError,
} from "@/lib/api";
import { useAuth } from "@/lib/hooks/useAuth";
import { usePrimaryFarmId } from "@/lib/hooks";
import { useFarmContext } from "@/lib/farmContext";
import type { FarmSettings, FarmSettingsPatch, Farm, Zone } from "@/lib/types";
import { useTranslations } from "next-intl";
import { SkeletonBlock } from "@/components/Skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ZoneValveControlBadge } from "@/components/ZoneValveControlBadge";

const THRESHOLD_FIELDS: { key: keyof FarmSettings; labelKey: string; unit: string }[] = [
  { key: "moistureLow", labelKey: "moistureLow", unit: "%" },
  { key: "moistureHigh", labelKey: "moistureHigh", unit: "%" },
  { key: "batteryLow", labelKey: "batteryLow", unit: "%" },
  { key: "batteryCritical", labelKey: "batteryCritical", unit: "%" },
  { key: "nitrogenLow", labelKey: "nitrogenLow", unit: "ppm" },
  { key: "phosphorusLow", labelKey: "phosphorusLow", unit: "ppm" },
  { key: "potassiumLow", labelKey: "potassiumLow", unit: "ppm" },
  { key: "soilTempLowExtreme", labelKey: "soilTempLowExtreme", unit: "°C" },
  { key: "soilTempHighExtreme", labelKey: "soilTempHighExtreme", unit: "°C" },
  { key: "offlineMinutes", labelKey: "offlineMinutes", unit: "min" },
  { key: "irrigationMaxRunningMinutes", labelKey: "irrigationMaxRunningMinutes", unit: "min" },
];

export default function SettingsPage() {
  const t = useTranslations("pageHeadings");
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-8 w-64" />
        <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-4">
          <SkeletonBlock className="h-5 w-48" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="border-b border-soil-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment flex items-center gap-3">
          <SlidersHorizontal className="w-7 h-7 text-olive-400" />
          <span>{t("settingsTitle")}</span>
        </h1>
        <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
          {t("settingsSub")}
        </p>
      </div>

      {(user.role === "admin") ? (
        <PlatformView />
      ) : (
        <ClientView user={user} />
      )}
    </div>
  );
}

// ── Shared: banner ──────────────────────────────────────────────────────────

function Banner({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      role="status"
      className={`p-3 rounded-lg text-xs font-mono font-medium flex items-center gap-2 ${
        ok
          ? "bg-olive-600/15 border border-olive-500/40 text-olive-400"
          : "bg-clay-500/10 border border-clay-500/40 text-clay-400"
      }`}
    >
      {ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

// ── Shared: numeric field ───────────────────────────────────────────────────

function NumberField({
  label,
  unit,
  value,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70 flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="text-parchment/40 normal-case">{unit}</span>
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border font-mono text-sm text-parchment focus:outline-none transition-colors ${
          disabled
            ? "border-soil-800 text-parchment/50 cursor-not-allowed"
            : "border-soil-700 focus:border-olive-400"
        }`}
      />
    </label>
  );
}

// ── Thresholds card (shared by both views) ──────────────────────────────────

function ThresholdsCard({
  farmId,
  canEdit,
}: {
  farmId: string | null;
  canEdit: boolean;
}) {
  const [values, setValues] = useState<FarmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const t = useTranslations("settings");

  const reload = useCallback(async (): Promise<void> => {
    if (!farmId) return;
    setLoading(true);
    try {
      setValues(await getFarmSettings(farmId));
    } catch (err) {
      setBanner({ ok: false, text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setValues(null);
    void reload();
  }, [reload]);

  // HARD GUARD (after all hooks — Rules of Hooks): without a definitively
  // selected farm this card is NOT rendered at all, not even an empty state.
  if (!farmId) return null;

  const handleSave = async (): Promise<void> => {
    if (!farmId || !values) return;
    setSaving(true);
    try {
      const patch: FarmSettingsPatch = {};
      for (const field of THRESHOLD_FIELDS) patch[field.key] = values[field.key];
      setValues(await updateFarmSettings(farmId, patch));
      setBanner({ ok: true, text: t("settingsSaved") });
      setTimeout(() => setBanner(null), 6000);
    } catch (err) {
      setBanner({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={t("thresholdsSection")} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-5 shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-soil-800 pb-3">
        <div>
          <h2 className="text-lg font-display font-bold text-parchment">{t("thresholdsSection")}</h2>
          <p className="text-xs text-parchment/60 font-sans">
            {t("thresholdsSub")}
          </p>
        </div>
        {!canEdit && (
          <span className="px-2 py-1 rounded text-[11px] font-mono bg-soil-950 text-parchment/50 border border-soil-800">
            {t("readOnlyTechPlus")}
          </span>
        )}
      </div>

      {banner && <Banner {...banner} />}

      {loading || !values ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-[74px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {THRESHOLD_FIELDS.map((field) => (
              <NumberField
                key={field.key}
                label={t("thresholdField." + field.labelKey)}
                unit={field.unit}
                value={values[field.key]}
                disabled={!canEdit}
                onChange={(v) => setValues((prev) => (prev ? { ...prev, [field.key]: v } : prev))}
              />
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            {canEdit ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto min-h-[48px] px-6 py-2.5 rounded-lg bg-olive-500 hover:bg-olive-600 active:bg-olive-700 text-soil-950 font-mono font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-60"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                    <span>{t("saving")}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 stroke-[2.5]" />
                    <span>{t("saveSettings")}</span>
                  </>
                )}
              </button>
            ) : (
              <span className="text-xs font-mono text-parchment/40">{t("editRequiresRole")}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── Client users view (farmer / technician) ─────────────────────────────────

function ClientView({ user }: { user: AuthUser }) {
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  // farmId comes EXCLUSIVELY from the shared global farm context
  // (usePrimaryFarmId resolves it for farmer via own org, for staff via context)
  const resolvedFarmId = usePrimaryFarmId();
  const farmId = resolvedFarmId ?? "";

  return (
    <div className="space-y-6">
      {banner && <Banner {...banner} />}

      {/* No farm context active → nothing farm-scoped renders at all (no
          Alert Thresholds card, no empty-state placeholder). */}
      {!!farmId && (
        <>
          <ThresholdsCard farmId={farmId} canEdit />
          {/* Zones management — technician+/admin only (farmer has no zones.edit). */}
          {canEditSpatial(user) && <ZonesCard farmId={farmId} />}
          {user.role === "farmer" && (
            <FarmIdentityCard farmId={farmId} onBanner={setBanner} />
          )}
        </>
      )}
    </div>
  );
}

// ── Farm identity (name/location, client roles) ─────────────────────────────

function FarmIdentityCard({
  farmId,
  farm,
  onBanner,
}: {
  farmId: string;
  farm?: Farm;
  onBanner: (b: { ok: boolean; text: string } | null) => void;
}) {
  const [name, setName] = useState(farm?.name ?? "");
  const [location, setLocation] = useState(farm?.location ?? "");
  const [saving, setSaving] = useState(false);
  // Farm area is GPS-derived (turf) from the drawn boundary — surfaced as
  // read-only text, with no manual entry. Loaded lazily via spatial endpoint.
  const [totalAreaHa, setTotalAreaHa] = useState<number | null>(null);
  const t = useTranslations("settings");

  useEffect(() => {
    let alive = true;
    getFarmSpatial(farmId)
      .then((s) => {
        if (alive) setTotalAreaHa(s.totalAreaHa);
      })
      .catch(() => {
        /* spatial opt-in — ignore; area stays unknown */
      });
    return () => {
      alive = false;
    };
  }, [farmId]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await updateFarm(farmId, { name, location });
      onBanner({ ok: true, text: t("farmDetailsUpdated") });
      setTimeout(() => onBanner(null), 4000);
    } catch (err) {
      onBanner({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const areaLabel =
    typeof totalAreaHa === "number" && Number.isFinite(totalAreaHa) && totalAreaHa > 0
      ? t("areaCalculated", { ha: totalAreaHa.toLocaleString(undefined, { maximumFractionDigits: 2 }) })
      : t("areaNotCalculated");

  return (
    <section aria-label={t("farmIdentitySection")} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-4 shadow-lg">
      <div className="flex items-center gap-3 border-b border-soil-800 pb-3">
        <Building2 className="w-5 h-5 text-olive-400" />
        <h2 className="text-lg font-display font-bold text-parchment">{t("farmIdentityTitle")}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1.5 block">
          <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("nameLabel")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400"
          />
        </label>
        <label className="space-y-1.5 block">
          <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("locationLabel")}</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400"
          />
        </label>
      </div>

      {/* Area — auto-calculated from the drawn GPS boundary, read-only. */}
      <div className="p-3 rounded-lg bg-soil-950 border border-soil-700 text-xs font-mono text-parchment/70">
        <span className="uppercase tracking-wider text-parchment/40">{t("farmAreaLabel")}</span>
        <span className={typeof totalAreaHa === "number" && totalAreaHa > 0 ? "text-olive-400" : "text-parchment/50"}>
          {areaLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !name.trim()}
        className="min-h-[48px] px-6 py-2.5 rounded-lg bg-soil-800 hover:bg-soil-700 text-olive-400 border border-soil-600 font-mono font-bold text-xs flex items-center gap-2 transition-colors disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Save className="w-4 h-4" />}
        {t("saveFarmDetails")}
      </button>
    </section>
  );
}

// ── Zone management (technician+/admin only) ─────────────────────────────────

const ZONE_FORM_FIELDS: {
  key: "name" | "cropType" | "targetMoisture" | "soilType";
  unit?: string;
  type?: "text" | "number";
  phKey?: string;
}[] = [
  { key: "name", phKey: "namePh" },
  { key: "cropType", phKey: "cropTypePh" },
  { key: "targetMoisture", unit: "%", type: "number" },
  { key: "soilType", phKey: "soilTypePh" },
];

function ZonesCard({ farmId }: { farmId: string }) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Zone | null>(null);
  const [forceRemove, setForceRemove] = useState<{ zone: Zone; activeNodeCount: number } | null>(null);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const t = useTranslations("settings");

  const reload = useCallback(async (): Promise<void> => {
    try {
      setZones(await getZones(farmId, { includeInactive: showArchived }));
    } catch (err) {
      setLocalError((err as Error).message);
    }
  }, [farmId, showArchived]);

  useEffect(() => {
    setZones(null);
    void reload();
  }, [reload]);

  const notify = (text: string): void => {
    setBanner({ ok: true, text });
    setTimeout(() => setBanner(null), 7000);
  };

  const handleCreated = async (zone: Zone): Promise<void> => {
    setAdding(false);
    notify(t("zoneCreated", { name: zone.name }));
    await reload();
  };

  const handleEdited = async (zone: Zone, msg: string): Promise<void> => {
    setEditing(null);
    notify(msg);
    await reload();
  };

  const handleRemoveConfirmed = async (): Promise<void> => {
    if (!pendingRemove) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await deleteZone(pendingRemove.id);
      setPendingRemove(null);
      if (res.mode === "archived") {
        notify(t("zoneArchived", { name: pendingRemove.name }));
      } else {
        notify(t("zoneDeleted", { name: pendingRemove.name }));
      }
      await reload();
    } catch (err) {
      // 409 + node count → NOT a dead end: offer the "remove anyway?" popup,
      // which detaches + deactivates the nodes and proceeds. Anything else
      // (e.g. a valve currently irrigating) surfaces INLINE with the reason.
      const blocked =
        err instanceof ApiError &&
        err.status === 409 &&
        typeof (err.data as { activeNodeCount?: unknown } | null)?.activeNodeCount === "number"
          ? (err.data as { activeNodeCount: number }).activeNodeCount
          : null;
      if (blocked !== null) {
        setForceRemove({ zone: pendingRemove, activeNodeCount: blocked });
        setPendingRemove(null);
      } else {
        setLocalError((err as Error).message);
        setPendingRemove(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleForceRemoveConfirmed = async (): Promise<void> => {
    if (!forceRemove) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await deleteZone(forceRemove.zone.id, { force: true });
      const detached = res.detachedActiveNodes ?? 0;
      if (detached > 0) {
        notify(t("zoneDeletedWithNodes", { name: forceRemove.zone.name, count: detached }));
      } else if (res.mode === "archived") {
        notify(t("zoneArchived", { name: forceRemove.zone.name }));
      } else {
        notify(t("zoneDeleted", { name: forceRemove.zone.name }));
      }
      setForceRemove(null);
      await reload();
    } catch (err) {
      setLocalError((err as Error).message);
      setForceRemove(null);
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async (zone: Zone): Promise<void> => {
    setReactivating(zone.id);
    setLocalError(null);
    try {
      await updateZone(zone.id, { active: true });
      notify(t("zoneReactivated", { name: zone.name }));
      await reload();
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setReactivating(null);
    }
  };

  const list = zones ?? [];
  const activeZones = list.filter((z) => z.active !== false);
  const archivedZones = list.filter((z) => z.active === false);

  return (
    <section aria-label={t("zonesSection")} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-5 shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-soil-800 pb-3">
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-olive-400" />
          <div>
            <h2 className="text-lg font-display font-bold text-parchment">{t("zonesSection")}</h2>
            <p className="text-xs text-parchment/60 font-sans">
              {t("zonesSub")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-[44px] px-4 rounded-lg bg-olive-500 hover:bg-olive-600 active:bg-olive-700 text-soil-950 font-mono font-bold text-xs flex items-center gap-2 transition-all shadow disabled:opacity-60"
        >
          <Plus className="w-4 h-4" /> {t("addZone")}
        </button>
      </div>

      {banner && <Banner {...banner} />}
      {localError && <Banner ok={false} text={localError} />}

      {/* Show-archived toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="w-4 h-4 accent-olive-500"
        />
        <span className="text-xs font-mono text-parchment/70 flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5" /> {t("showArchivedZones")}
        </span>
      </label>

      {zones === null ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-14 w-full" />
          <SkeletonBlock className="h-14 w-full" />
        </div>
      ) : list.length === 0 ? (
        <div className="bg-soil-950/40 border-2 border-dashed border-soil-700 rounded-xl p-8 text-center text-parchment/50 font-mono text-sm">
          {t("noZonesYet")}
        </div>
      ) : (
        <>
          {activeZones.length > 0 && (
            <ul className="divide-y divide-soil-800 border border-soil-800 rounded-xl overflow-hidden">
              {activeZones.map((zone) => (
                <ZoneRow
                  key={zone.id}
                  zone={zone}
                  onEdit={() => setEditing(zone)}
                  onRemove={() => setPendingRemove(zone)}
                />
              ))}
            </ul>
          )}

          {showArchived && archivedZones.length > 0 && (
            <>
              <div className="text-xs font-mono uppercase tracking-wider text-parchment/50 pt-1">
                {t("archivedCount", { count: archivedZones.length })}
              </div>
              <ul className="divide-y divide-soil-800 border border-soil-800 rounded-xl overflow-hidden">
                {archivedZones.map((zone) => (
                  <li key={zone.id} className="p-3.5 flex items-center justify-between gap-3 flex-wrap bg-soil-950/30 opacity-70">
                    <div className="min-w-0">
                      <div className="text-sm text-parchment/60 line-through">{zone.name}</div>
                      <div className="text-[11px] font-mono text-parchment/40 mt-0.5">
                        {zone.cropType} · target {zone.targetMoisture}% · {t("nodeCountFmt", { count: zone.nodeCount ?? zone.activeNodeCount })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-soil-800 text-parchment/50 border border-soil-700">
                        {t("archived")}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleReactivate(zone)}
                        disabled={reactivating === zone.id}
                        className="min-h-[44px] px-3 rounded-lg text-olive-400 hover:bg-olive-600/10 border border-transparent hover:border-olive-500/30 font-mono text-[11px] font-bold transition-colors disabled:opacity-50"
                      >
                        {reactivating === zone.id ? t("reactivating") : t("reactivate")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Add-zone modal */}
      {adding && (
        <ZoneFormModal
          farmId={farmId}
          onClose={() => setAdding(false)}
          onSubmit={async (input) => {
            const zone = await createZone(farmId, input);
            await handleCreated(zone);
          }}
        />
      )}

      {/* Edit-zone modal (pre-filled) */}
      {editing && (
        <ZoneFormModal
          farmId={farmId}
          zone={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            const updated = await updateZone(editing.id, input);
            await handleEdited(updated, t("zoneUpdated", { name: updated.name }));
          }}
        />
      )}

      {/* Remove confirmation — history-aware lifecycle (archive-or-hard-delete). */}
      {pendingRemove && (
        <ConfirmDialog
          isOpen
          title={t("confirmRemoveZoneTitle")}
          message={t("confirmRemoveZoneMsg", { name: pendingRemove.name })}
          confirmText={busy ? t("working") : t("removeZone")}
          cancelText={t("cancel")}
          variant="danger"
          onConfirm={() => void handleRemoveConfirmed()}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {/* Forced removal — zone still has active nodes: warn, then proceed.
          The nodes are deactivated + unassigned, never deleted. */}
      {forceRemove && (
        <ConfirmDialog
          isOpen
          title={t("confirmForceRemoveZoneTitle")}
          message={t("confirmForceRemoveZoneMsg", {
            name: forceRemove.zone.name,
            count: forceRemove.activeNodeCount,
          })}
          confirmText={busy ? t("working") : t("removeZoneAnyway")}
          cancelText={t("cancel")}
          variant="danger"
          onConfirm={() => void handleForceRemoveConfirmed()}
          onCancel={() => setForceRemove(null)}
        />
      )}
    </section>
  );
}

function ZoneRow({
  zone,
  onEdit,
  onRemove,
}: {
  zone: Zone;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("settings");
  return (
    <li className="p-3.5 flex items-center justify-between gap-3 flex-wrap bg-soil-950/40">
      <div className="min-w-0">
        <div className="text-sm text-parchment truncate flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-olive-400/70 shrink-0" />
          {zone.name}
        </div>
        <div className="text-[11px] font-mono text-parchment/50 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>
            {zone.cropType} · target {zone.targetMoisture}% · {t("nodeCountFmt", { count: zone.nodeCount ?? zone.activeNodeCount })} ·{" "}
            {t("scheduleCount", { count: zone.activeScheduleCount ?? 0 })}
          </span>
          <ZoneValveControlBadge zone={zone} />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="min-h-[44px] px-3 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" /> {t("edit")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={t("removeZoneTitle")}
          className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-parchment/40 hover:text-clay-400 hover:bg-clay-600/10 border border-transparent hover:border-clay-500/30 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}

/** Create or edit zone — pre-fills from `zone` when editing, otherwise blank. */
function ZoneFormModal({
  farmId,
  zone,
  onClose,
  onSubmit,
}: {
  farmId: string;
  zone?: Zone;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    cropType: string;
    targetMoisture: number;
    soilType?: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: zone?.name ?? "",
    cropType: zone?.cropType ?? "",
    targetMoisture: zone?.targetMoisture ?? 60,
    soilType: zone?.soilType ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("settings");

  // Area is now GPS-derived automatically (turf) whenever the zone boundary is
  // drawn/edited on the Farm Map — there is no manual area entry. We just
  // surface the current computed value as read-only text.
  const areaHa = zone?.areaHectares;
  const areaLabel =
    typeof areaHa === "number" && Number.isFinite(areaHa) && areaHa > 0
      ? t("areaCalculated", { ha: areaHa.toLocaleString(undefined, { maximumFractionDigits: 2 }) })
      : t("areaNotCalculated");

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        cropType: form.cropType.trim(),
        targetMoisture: Number(form.targetMoisture),
        ...(form.soilType.trim() !== "" ? { soilType: form.soilType.trim() } : {}),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const inputCls =
    "w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-soil-800 pb-3">
          {zone ? <Pencil className="w-5 h-5 text-olive-400" /> : <Plus className="w-5 h-5 text-olive-400" />}
          <h2 className="text-lg font-display font-bold text-parchment">{zone ? t("editZoneTitle") : t("addZoneTitle")}</h2>
        </div>

        <p className="text-xs font-mono text-parchment/60">
          {zone ? t("zoneEditSub") : t("zoneCreateSub")}
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono">{error}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ZONE_FORM_FIELDS.map((f) => (
            <label key={f.key} className={`space-y-1.5 block ${f.key === "name" ? "sm:col-span-2" : ""}`}>
              <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70 flex items-center justify-between gap-2">
                <span>{t("zoneField." + f.key)}</span>
                {f.unit && <span className="text-parchment/40 normal-case">{f.unit}</span>}
              </span>
              <input
                type={f.type ?? "text"}
                required={f.key === "name" || f.key === "cropType" || f.key === "targetMoisture"}
                min={f.type === "number" ? 0 : undefined}
                max={f.type === "number" && f.key === "targetMoisture" ? 100 : undefined}
                placeholder={f.phKey ? t("zoneField." + f.phKey) : undefined}
                value={form[f.key] as string}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className={inputCls}
              />
            </label>
          ))}
        </div>

        {/* Area is auto-derived from the drawn GPS boundary (turf) — read-only. */}
        <div className="p-3 rounded-lg bg-soil-950 border border-soil-700 text-xs font-mono text-parchment/70">
          <span className="uppercase tracking-wider text-parchment/40">{t("areaLabel")}</span>
          <span className={typeof areaHa === "number" && areaHa > 0 ? "text-olive-400" : "text-parchment/50"}>
            {areaLabel}
          </span>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 text-xs font-mono disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-xs flex items-center gap-2 shadow disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Save className="w-4 h-4" />}
            {zone ? t("saveChanges") : t("createZone")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Platform-admin view: thresholds (context-gated) + org/user management ───

function PlatformView() {
  const { activeFarm } = useFarmContext();
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setOrgs(await getAdminOrgs());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-6">
      {error && <Banner ok={false} text={error} />}
      {banner && <Banner {...banner} />}

      {/* Alert thresholds: gated on the ONE shared farm context. With no context
          the card is NOT rendered at all (nothing occupies this space); Client
          Organizations below stays available either way. The card also
          self-guards (returns null) if it ever gets a falsy farmId. */}
      {activeFarm?.farmId && (
        <>
          <ThresholdsCard farmId={activeFarm.farmId} canEdit />
          <ZonesCard farmId={activeFarm.farmId} />
        </>
      )}

      <ClientOrganizationsCard orgs={orgs} onReload={reload} onBanner={setBanner} />
      <ManageUsersCard orgs={orgs} onBanner={setBanner} />
    </div>
  );
}

// ── Client Organizations management (orgs + nested farms) ───────────────────

function ClientOrganizationsCard({
  orgs,
  onReload,
  onBanner,
}: {
  orgs: AdminOrg[] | null;
  onReload: () => void;
  onBanner: (b: { ok: boolean; text: string } | null) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddFarmToOrg, setShowAddFarmToOrg] = useState<{ orgId: string; orgName: string } | null>(null);
  const [editingFarm, setEditingFarm] = useState<{ orgId: string; farm: OrgFarmStats } | null>(null);
  const [pendingFarmRemove, setPendingFarmRemove] = useState<{ org: AdminOrg; farm: OrgFarmStats } | null>(null);
  const [pendingOrgRemove, setPendingOrgRemove] = useState<AdminOrg | null>(null);
  const [newOrg, setNewOrg] = useState({ name: "", farmName: "" });
  const [creating, setCreating] = useState(false);
  const t = useTranslations("settings");

  const handleFarmRemoveConfirmed = async (): Promise<void> => {
    if (!pendingFarmRemove) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await adminDeleteFarm(pendingFarmRemove.farm.farmId);
      onBanner({
        ok: true,
        text:
          res.mode === "archived"
            ? t("farmArchived", { name: pendingFarmRemove.farm.farmName })
            : t("farmDeleted", { name: pendingFarmRemove.farm.farmName }),
      });
      setTimeout(() => onBanner(null), 7000);
      setPendingFarmRemove(null);
      await onReload();
    } catch (err) {
      setLocalError((err as Error).message);
      setPendingFarmRemove(null);
    } finally {
      setBusy(false);
    }
  };

  const handleOrgRemoveConfirmed = async (): Promise<void> => {
    if (!pendingOrgRemove) return;
    setBusy(true);
    setLocalError(null);
    try {
      await adminDeleteOrg(pendingOrgRemove.orgId);
      onBanner({ ok: true, text: t("orgDeleted", { name: pendingOrgRemove.orgName }) });
      setTimeout(() => onBanner(null), 5000);
      setPendingOrgRemove(null);
      await onReload();
    } catch (err) {
      // 400 (farms/users still attached) surfaces INLINE with the server reason.
      setLocalError((err as Error).message);
      setPendingOrgRemove(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setCreating(true);
    setLocalError(null);
    try {
      await createNewOrgWithFarm({
        orgName: newOrg.name.trim(),
        firstFarmName: newOrg.farmName.trim() || t("firstFarmDefault", { name: newOrg.name.trim() }),
      });
      setNewOrg({ name: "", farmName: "" });
      await onReload();
      onBanner({ ok: true, text: t("clientOnboarded", { name: newOrg.name.trim() }) });
      setTimeout(() => onBanner(null), 5000);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const inputCls =
    "w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400";

  return (
    <section aria-label={t("clientOrgsSection")} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-5 shadow-lg">
      <div className="flex items-center gap-3 border-b border-soil-800 pb-3">
        <Building2 className="w-5 h-5 text-clay-400" />
        <div>
          <h2 className="text-lg font-display font-bold text-parchment">{t("clientOrgsTitle")}</h2>
          <p className="text-xs text-parchment/60 font-sans">
            {t("clientOrgsSub")}
          </p>
        </div>
      </div>

      {localError && <Banner ok={false} text={localError} />}

      {orgs === null ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-12 w-full" />
          <SkeletonBlock className="h-12 w-full" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="bg-soil-950/40 border-2 border-dashed border-soil-700 rounded-xl p-8 text-center text-parchment/50 font-mono text-sm">
          {t("noOrgsYet")}
        </div>
      ) : (
        <ul className="space-y-3">
          {orgs.map((org) => (
            <li key={org.orgId} className="bg-soil-950/40 border border-soil-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-4 flex-wrap">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [org.orgId]: !prev[org.orgId] }))}
                  aria-expanded={Boolean(expanded[org.orgId])}
                  className="flex items-center gap-3 min-w-0 text-left flex-1"
                >
                  <Building2 className="w-5 h-5 text-olive-400 shrink-0" />
                  <span className="text-base font-display font-bold text-parchment truncate">{org.orgName}</span>
                  <span className="font-mono text-xs text-parchment/60 shrink-0">{t("farmCount", { count: org.farms.length })}</span>
                  {expanded[org.orgId] ? <ChevronDown className="w-5 h-5 shrink-0 text-parchment/50" /> : <ChevronRight className="w-5 h-5 shrink-0 text-parchment/50" />}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowAddFarmToOrg({ orgId: org.orgId, orgName: org.orgName })}
                    className="min-h-[44px] px-3 rounded-lg bg-soil-800 hover:bg-soil-700 text-olive-400 border border-soil-600 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors"
                    title={t("addFarmTitle")}
                  >
                    <Plus className="w-3.5 h-3.5" /> {t("addFarmBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingOrgRemove(org)}
                    disabled={busy}
                    title={t("removeOrgTitle")}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-parchment/40 hover:text-clay-400 hover:bg-clay-600/10 border border-transparent hover:border-clay-500/30 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {expanded[org.orgId] && (
                <ul className="border-t border-soil-800 divide-y divide-soil-800">
                  {org.farms.length === 0 && (
                    <li className="px-5 py-4 text-xs font-mono text-parchment/50">{t("noFarmsYet")}</li>
                  )}
                  {org.farms.map((farm) => (
                    <li key={farm.farmId} className="px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap pl-10">
                      <div className="min-w-0">
                        <div className="text-sm text-parchment truncate">{farm.farmName}</div>
                        <div className="text-[11px] font-mono text-parchment/50 mt-0.5">
                          {t("nodesActiveOf", { active: farm.activeNodeCount, total: farm.nodeCount })} · {t("openAlertCount", { count: farm.openAlertCount })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingFarm({ orgId: org.orgId, farm })}
                          className="min-h-[44px] px-3 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" /> {t("edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingFarmRemove({ org, farm })}
                          disabled={busy}
                          title={t("removeFarmTitle")}
                          className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-parchment/40 hover:text-clay-400 hover:bg-clay-600/10 border border-transparent hover:border-clay-500/30 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* New organization — onboarding a brand-new client (org + first farm). */}
      <form onSubmit={handleCreateOrg} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-2 border-t border-soil-800">
        <label className="space-y-1 block">
          <span className="text-[11px] font-mono uppercase text-parchment/70">{t("newOrgLabel")}</span>
          <input
            required
            placeholder={t("orgNamePh")}
            value={newOrg.name}
            onChange={(e) => setNewOrg((p) => ({ ...p, name: e.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-[11px] font-mono uppercase text-parchment/70">{t("firstFarmOptional")}</span>
          <input
            placeholder={t("farmNamePh")}
            value={newOrg.farmName}
            onChange={(e) => setNewOrg((p) => ({ ...p, farmName: e.target.value }))}
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="min-h-[48px] px-5 py-2.5 rounded-lg bg-soil-800 hover:bg-soil-700 text-olive-400 border border-soil-600 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Building2 className="w-4 h-4" />}
          {t("onboardClient")}
        </button>
      </form>

      {/* Add-farm modal — scoped to the exact org row it was opened from. */}
      {showAddFarmToOrg && (
        <AddFarmToOrgModal
          onClose={() => setShowAddFarmToOrg(null)}
          onCreated={async () => {
            setShowAddFarmToOrg(null);
            await onReload();
          }}
          orgId={showAddFarmToOrg.orgId}
          orgName={showAddFarmToOrg.orgName}
        />
      )}

      {/* Farm edit modal — name + org reassignment + coordinates. */}
      {editingFarm && (
        <EditFarmModal
          orgs={orgs ?? []}
          orgId={editingFarm.orgId}
          farm={editingFarm.farm}
          onClose={() => setEditingFarm(null)}
          onSaved={async (msg) => {
            setEditingFarm(null);
            onBanner({ ok: true, text: msg });
            setTimeout(() => onBanner(null), 6000);
            await onReload();
          }}
        />
      )}

      {/* Farm remove confirmation — lifecycle-aware, never skipped. */}
      {pendingFarmRemove && (
        <ConfirmDialog
          isOpen
          title={t("confirmRemoveFarmTitle")}
          message={t("confirmRemoveFarmMsg", { name: pendingFarmRemove.farm.farmName })}
          confirmText={busy ? t("working") : t("removeFarm")}
          cancelText={t("cancel")}
          variant="danger"
          onConfirm={() => void handleFarmRemoveConfirmed()}
          onCancel={() => setPendingFarmRemove(null)}
        />
      )}

      {/* Organization remove confirmation — server rejects (400) if non-empty. */}
      {pendingOrgRemove && (
        <ConfirmDialog
          isOpen
          title={t("confirmRemoveOrgTitle")}
          message={t("confirmRemoveOrgMsg", { name: pendingOrgRemove.orgName })}
          confirmText={busy ? t("working") : t("removeOrganization")}
          cancelText={t("cancel")}
          variant="danger"
          onConfirm={() => void handleOrgRemoveConfirmed()}
          onCancel={() => setPendingOrgRemove(null)}
        />
      )}
    </section>
  );
}

// ── Add-farm to existing org modal ──────────────────────────────────────────

function AddFarmToOrgModal({
  onClose,
  onCreated,
  orgId,
  orgName,
}: {
  onClose: () => void;
  onCreated: () => void;
  orgId: string;
  orgName: string;
}) {
  const [form, setForm] = useState({
    farmName: "",
    location: "",
    farmLat: "",
    farmLon: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("settings");

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    // Guard: this modal must ALWAYS target the org row it was opened from.
    // A missing orgId means the button was mis-wired — fail loudly, never
    // fall through to (or create) anything else.
    if (!orgId || orgId.trim() === "") {
      setError(t("internalErrorFarmOrg"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addFarmToExistingOrg({
        orgId,
        farmName: form.farmName.trim(),
        location: form.location.trim() || undefined,
        farmLat: form.farmLat === "" ? undefined : Number(form.farmLat),
        farmLon: form.farmLon === "" ? undefined : Number(form.farmLon),
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const inputCls =
    "w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-soil-800 pb-3">
          <Plus className="w-5 h-5 text-olive-400" />
          <h2 className="text-lg font-display font-bold text-parchment">{t("addFarmToClientTitle")}</h2>
        </div>

        <p className="text-xs font-mono text-parchment/60">
          {t.rich("addingFarmTo", { org: (chunks) => <strong className="text-parchment">{chunks}</strong>, name: orgName })}
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono">{error}</div>
        )}

        <input required placeholder={t("farmNameReq")} value={form.farmName}
          onChange={(e) => setForm((p) => ({ ...p, farmName: e.target.value }))} className={inputCls} />
        <input placeholder={t("locationOptional")} value={form.location}
          onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} className={inputCls} />
        <div className="grid grid-cols-2 gap-3">
          <input type="number" step="any" placeholder={t("farmLatitudeOptional")} value={form.farmLat}
            onChange={(e) => setForm((p) => ({ ...p, farmLat: e.target.value }))} className={inputCls + " min-h-[48px]"} />
          <input type="number" step="any" placeholder={t("farmLongitudeOptional")} value={form.farmLon}
            onChange={(e) => setForm((p) => ({ ...p, farmLon: e.target.value }))} className={inputCls + " min-h-[48px]"} />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 text-xs font-mono disabled:opacity-50">
            {t("cancel")}
          </button>
          <button type="submit" disabled={busy}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-xs flex items-center gap-2 shadow disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Plus className="w-4 h-4" />}
            {t("addFarm")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Edit farm modal (name / org reassignment / coordinates) ─────────────────

function EditFarmModal({
  orgs,
  orgId: currentOrgId,
  farm,
  onClose,
  onSaved,
}: {
  orgs: AdminOrg[];
  orgId: string;
  farm: OrgFarmStats;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(farm.farmName);
  const [targetOrgId, setTargetOrgId] = useState(currentOrgId);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("settings");

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminUpdateFarm(farm.farmId, {
        name: name.trim(),
        ...(targetOrgId !== currentOrgId ? { orgId: targetOrgId } : {}),
        ...(lat.trim() !== "" ? { centerLat: Number(lat) } : {}),
        ...(lon.trim() !== "" ? { centerLon: Number(lon) } : {}),
      });
      const oldOrgName = orgs.find((o) => o.orgId === currentOrgId)?.orgName;
      const newOrgName = orgs.find((o) => o.orgId === targetOrgId)?.orgName;
      onSaved(
        result.reassigned
          ? t("farmMoved", { name: name.trim(), from: oldOrgName ?? currentOrgId, to: newOrgName ?? targetOrgId })
          : t("farmUpdated", { name: name.trim() })
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const inputCls =
    "w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-soil-800 pb-3">
          <Pencil className="w-5 h-5 text-olive-400" />
          <h2 className="text-lg font-display font-bold text-parchment">{t("editFarmTitle")}</h2>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono">{error}</div>
        )}

        <label className="space-y-1.5 block">
          <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("farmNameLabel")}</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>

        <label className="space-y-1.5 block">
          <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("orgReassignLabel")}</span>
          <select
            value={targetOrgId}
            onChange={(e) => setTargetOrgId(e.target.value)}
            className={inputCls + " cursor-pointer"}
          >
            {orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.orgName}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("centerLatLabel")}</span>
            <input
              type="number" step="any" placeholder={t("keepCurrent")}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className={inputCls + " min-h-[48px]"}
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("centerLonLabel")}</span>
            <input
              type="number" step="any" placeholder={t("keepCurrent")}
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              className={inputCls + " min-h-[48px]"}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 text-xs font-mono disabled:opacity-50">
            {t("cancel")}
          </button>
          <button type="submit" disabled={busy}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-xs flex items-center gap-2 shadow disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Save className="w-4 h-4" />}
            {t("saveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Manage Users (moved from the admin console) ─────────────────────────────

function ManageUsersCard({
  orgs,
  onBanner,
}: {
  orgs: AdminOrg[] | null;
  onBanner: (b: { ok: boolean; text: string } | null) => void;
}) {
  const [selectedFarmId, setSelectedFarmId] = useState<string>("");
  const [users, setUsers] = useState<{ id: string; email: string; fullName: string; role: string; isActive: boolean }[] | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", role: "farmer" as "farmer" | "technician", temporaryPassword: "" });
  const [editing, setEditing] = useState<{ id: string; fullName: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; fullName: string } | null>(null);
  const t = useTranslations("settings");

  const loadUsers = useCallback(async (fid: string): Promise<void> => {
    if (!fid) return;
    try {
      const res = await getAdminFarmUsers(fid);
      setUsers(res.users);
    } catch (err) {
      setLocalError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!selectedFarmId) return;
    setUsers(null);
    void loadUsers(selectedFarmId);
  }, [selectedFarmId, loadUsers]);

  const allFarms = (orgs ?? []).flatMap((o) => o.farms);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedFarmId) return;
    const farm = allFarms.find((f) => f.farmId === selectedFarmId);
    const org = (orgs ?? []).find((o) => o.farms.some((f) => f.farmId === selectedFarmId));
    if (!org) return;
    setBusy(true);
    setLocalError(null);
    try {
      await adminCreateUser({
        role: form.role,
        orgId: org.orgId,
        farmId: selectedFarmId,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        temporaryPassword: form.temporaryPassword,
      });
      setForm({ fullName: "", email: "", role: "farmer", temporaryPassword: "" });
      onBanner({
        ok: true,
        text: t("userCreated", { email: form.email, farm: farm?.farmName ?? t("farmNamePh") }),
      });
      setTimeout(() => onBanner(null), 8000);
      await loadUsers(selectedFarmId);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Deactivate: PATCH { active: false } — revokes login, keeps the account.
  const handleDeactivate = async (userId: string): Promise<void> => {
    setBusy(true);
    try {
      await adminUpdateUser(userId, { active: false });
      await loadUsers(selectedFarmId);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async (userId: string): Promise<void> => {
    setBusy(true);
    try {
      await adminUpdateUser(userId, { active: true });
      await loadUsers(selectedFarmId);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setLocalError(null);
    try {
      await adminUpdateUser(editing.id, {
        fullName: editing.fullName.trim(),
        email: editing.email.trim(),
      });
      setEditing(null);
      await loadUsers(selectedFarmId);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirmed = async (): Promise<void> => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const res = await adminDeactivateUser(pendingDelete.id);
      if (res.mode === "archived") {
        onBanner({
          ok: true,
          text: t("userHasHistory", { name: pendingDelete.fullName }),
        });
        setTimeout(() => onBanner(null), 10000);
      } else {
        onBanner({ ok: true, text: t("userDeleted", { name: pendingDelete.fullName }) });
        setTimeout(() => onBanner(null), 5000);
      }
      setPendingDelete(null);
      await loadUsers(selectedFarmId);
    } catch (err) {
      setLocalError((err as Error).message);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400";

  return (
    <section aria-label={t("manageUsersSection")} className="bg-soil-900 border-2 border-soil-700 rounded-xl p-6 space-y-5 shadow-lg">
      <div className="flex items-center gap-3 border-b border-soil-800 pb-3">
        <UsersIcon className="w-5 h-5 text-olive-400" />
        <div>
          <h2 className="text-lg font-display font-bold text-parchment">{t("manageUsersTitle")}</h2>
          <p className="text-xs text-parchment/60 font-sans">
            {t("manageUsersSub")}
          </p>
        </div>
      </div>

      {/* Farm selector (this is a per-panel target picker, not the threshold picker) */}
      <label className="block max-w-md space-y-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("clientFarmLabel")}</span>
        <select
          value={selectedFarmId}
          onChange={(e) => setSelectedFarmId(e.target.value)}
          className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm cursor-pointer focus:outline-none focus:border-olive-400"
        >
          <option value="">{t("selectFarmPh")}</option>
          {allFarms.map((f) => (
            <option key={f.farmId} value={f.farmId}>
              {f.farmName}
            </option>
          ))}
        </select>
      </label>

      {localError && (
        <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono">{localError}</div>
      )}

      {!selectedFarmId ? (
        <p className="text-xs font-mono text-parchment/50">{t("selectFarmPrompt")}</p>
      ) : users === null ? (
        <SkeletonBlock className="h-24 w-full" />
      ) : (
        <>
          <ul className="divide-y divide-soil-800 border border-soil-800 rounded-xl overflow-hidden">
            {users.map((u) => (
              <li key={u.id} className="p-3.5 flex items-center justify-between gap-3 flex-wrap bg-soil-950/40">
                <div className="min-w-0">
                  <div className={`text-sm truncate ${u.isActive ? "text-parchment" : "text-parchment/40 line-through"}`}>
                    {u.fullName}
                    {!u.isActive && <span className="ml-2 text-[10px] font-mono">{t("deactivated")}</span>}
                  </div>
                  <div className="text-xs font-mono text-parchment/60">{u.email}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono capitalize bg-soil-800 text-parchment/70 border border-soil-700">
                    {t("role." + u.role)}
                  </span>
                  {u.isActive ? (
                    <>
                      {/* ACTIVE → Edit + Deactivate (PATCH active:false) */}
                      <button
                        type="button"
                        onClick={() => setEditing({ id: u.id, fullName: u.fullName, email: u.email })}
                        disabled={busy}
                        title={t("editNameEmailTitle")}
                        className="min-h-[44px] px-3 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Pencil className="w-3.5 h-3.5" /> {t("edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(u.id)}
                        disabled={busy}
                        title={t("deactivateTitle")}
                        className="min-h-[44px] px-3 rounded-lg text-wheat-400 hover:bg-wheat-600/10 border border-transparent hover:border-wheat-500/30 font-mono text-[11px] font-bold transition-colors disabled:opacity-50"
                      >
                        {t("deactivate")}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* DEACTIVATED → Reactivate (PATCH active:true) + Delete */}
                      <button
                        type="button"
                        onClick={() => void handleReactivate(u.id)}
                        disabled={busy}
                        title={t("reactivateTitle")}
                        className="min-h-[44px] px-3 rounded-lg text-olive-400 hover:bg-olive-600/10 border border-transparent hover:border-olive-500/30 font-mono text-[11px] font-bold transition-colors disabled:opacity-50"
                      >
                        {t("reactivate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(u)}
                        title={t("deleteUserTitle")}
                        aria-label={t("deleteUserAria", { name: u.fullName })}
                        className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-parchment/40 hover:text-clay-400 hover:bg-clay-600/10 border border-transparent hover:border-clay-500/30 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {editing && (
            <form onSubmit={handleSaveEdit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end pt-3 border-t border-soil-800">
              <label className="space-y-1 block">
                <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("fullNameLabel")}</span>
                <input required value={editing.fullName}
                  onChange={(e) => setEditing((p) => (p ? { ...p, fullName: e.target.value } : p))} className={inputCls} />
              </label>
              <label className="space-y-1 block">
                <span className="text-[11px] font-mono uppercase tracking-wider text-parchment/70">{t("emailLabel")}</span>
                <input required type="email" value={editing.email}
                  onChange={(e) => setEditing((p) => (p ? { ...p, email: e.target.value } : p))} className={inputCls} />
              </label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setEditing(null)} disabled={busy}
                  className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 text-xs font-mono disabled:opacity-50">
                  {t("cancel")}
                </button>
                <button type="submit" disabled={busy}
                  className="min-h-[44px] px-5 py-2 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-xs flex items-center gap-2 shadow disabled:opacity-60">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Save className="w-4 h-4" />}
                  {t("save")}
                </button>
              </div>
              {localError && <div className="sm:col-span-3"><Banner ok={false} text={localError} /></div>}
            </form>
          )}

          {/* Delete confirmation — archive-or-hard-delete on the server */}
          {pendingDelete && (
            <ConfirmDialog
              isOpen
              title={t("confirmRemoveUserTitle")}
              message={t("confirmRemoveUserMsg", { name: pendingDelete.fullName })}
              confirmText={busy ? t("working") : t("remove")}
              cancelText={t("cancel")}
              variant="danger"
              onConfirm={() => void handleDeleteConfirmed()}
              onCancel={() => setPendingDelete(null)}
            />
          )}

          {/* Add user form */}
          <form onSubmit={handleCreate} className="space-y-4 pt-3 border-t border-soil-800">
            <span className="text-xs font-mono uppercase tracking-wider text-parchment/70">{t("newUserLabel")}</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input required placeholder={t("fullNamePh")} value={form.fullName}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} className={inputCls} />
              <input required type="email" placeholder={t("emailPh")} value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} className={inputCls} />
              <input required type="password" minLength={8} placeholder={t("tempPasswordPh")} value={form.temporaryPassword}
                onChange={(e) => setForm((p) => ({ ...p, temporaryPassword: e.target.value }))} className={inputCls + " min-h-[48px]"} />
              <select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as typeof p.role }))}
                className={inputCls + " min-h-[48px] cursor-pointer"}>
                <option value="farmer">{t("role.farmer")}</option>
                <option value="technician">{t("role.technician")}</option>
              </select>
            </div>
            <button type="submit" disabled={busy}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-xs shadow disabled:opacity-60">
              {t("addUser")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}