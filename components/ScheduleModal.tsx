"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Loader2,
  AlertTriangle,
  Calendar,
  CalendarClock,
  Clock,
  Droplet,
  Layers,
  Trash2,
  Pencil,
  Repeat,
  Zap,
} from "lucide-react";
import {
  getNodeSchedules,
  createNodeSchedule,
  updateSchedule,
  deleteNodeSchedule,
  type CreateScheduleInput,
} from "@/lib/api";
import type { IrrigationSchedule } from "@/lib/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkeletonBlock } from "@/components/Skeleton";
import { formatDateTime } from "@/lib/format";
import { useTranslations } from "next-intl";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
  nodeName: string;
  /** True when the viewer holds irrigation.manage (farmer/technician/admin). */
  canIrrigate: boolean;
}

export function ScheduleModal({
  isOpen,
  onClose,
  nodeId,
  nodeName,
  canIrrigate,
}: ScheduleModalProps) {
  const t = useTranslations("scheduleModal");
  const tCommon = useTranslations("common");
  const [schedules, setSchedules] = useState<IrrigationSchedule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"recurring" | "one_time">("recurring");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [startTime, setStartTime] = useState("06:00");
  const [duration, setDuration] = useState(30);
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [threshold, setThreshold] = useState(40);
  const [requireThreshold, setRequireThreshold] = useState(true);

  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IrrigationSchedule | null>(null);

  const close = (): void => {
    if (saving) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && isOpen) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, saving]);

  useEffect(() => {
    if (!isOpen) return;
    setEditingId(null);
    setTab("recurring");
    setError(null);
    setSchedules(null);
    setLoadError(null);
    getNodeSchedules(nodeId)
      .then((rows) => {
        setSchedules(rows);
        const first = rows.find((s) => s.scheduleType === "recurring") ?? rows[0];
        if (first) {
          setTab(first.scheduleType);
          if (first.scheduleType === "recurring") {
            setStartTime(first.startTime?.slice(0, 5) ?? "06:00");
            setDuration(first.durationMinutes);
            setDays(first.repeatDays.length > 0 ? first.repeatDays : [1, 3, 5]);
            setThreshold(first.moistureThreshold ?? 40);
          } else {
            setScheduledStart(toLocalInput(first.scheduledStart));
            setScheduledEnd(toLocalInput(first.scheduledEnd));
            if (first.moistureThreshold !== null) {
              setRequireThreshold(true);
              setThreshold(first.moistureThreshold);
            } else {
              setRequireThreshold(false);
            }
          }
        }
      })
      .catch((err) => setLoadError((err as Error).message));
  }, [isOpen, nodeId]);

  const oneTimeDuration = (): number => {
    const s = new Date(scheduledStart);
    const e = new Date(scheduledEnd);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 60_000));
  };

  const toggleDay = (d: number): void =>
    setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (tab === "recurring") {
        if (days.length === 0) throw new Error(t("pickerError"));
        const payload: CreateScheduleInput = {
          scheduleType: "recurring",
          startTime,
          durationMinutes: duration,
          repeatDays: days,
          moistureThreshold: threshold,
          active: true,
        };
        if (editingId) await updateSchedule(editingId, payload);
        else await createNodeSchedule(nodeId, payload);
      } else {
        if (!scheduledStart || !scheduledEnd) {
          throw new Error(t("pickStartEnd"));
        }
        const s = new Date(scheduledStart);
        const e = new Date(scheduledEnd);
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
          throw new Error(t("invalidDates"));
        }
        if (e.getTime() <= s.getTime()) {
          throw new Error(t("endAfterStart"));
        }
        const payload: CreateScheduleInput = {
          scheduleType: "one_time",
          scheduledStart,
          scheduledEnd,
          ...(requireThreshold ? { moistureThreshold: threshold } : {}),
          active: true,
        };
        if (editingId) await updateSchedule(editingId, payload);
        else await createNodeSchedule(nodeId, payload);
      }
      const rows = await getNodeSchedules(nodeId);
      setSchedules(rows);
      setEditingId(null);
      setTab("recurring");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (s: IrrigationSchedule): void => {
    setEditingId(s.id);
    setError(null);
    setTab(s.scheduleType);
    if (s.scheduleType === "recurring") {
      setStartTime(s.startTime?.slice(0, 5) ?? "06:00");
      setDuration(s.durationMinutes);
      setDays(s.repeatDays.length > 0 ? s.repeatDays : [1, 3, 5]);
      setThreshold(s.moistureThreshold ?? 40);
    } else {
      setScheduledStart(toLocalInput(s.scheduledStart));
      setScheduledEnd(toLocalInput(s.scheduledEnd));
      if (s.moistureThreshold !== null) {
        setRequireThreshold(true);
        setThreshold(s.moistureThreshold);
      } else {
        setRequireThreshold(false);
      }
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteNodeSchedule(nodeId, deleteTarget.id);
      const rows = await getNodeSchedules(nodeId);
      setSchedules(rows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  if (!isOpen) return null;

  // Portal to <body>: the modal is often opened from inside a Leaflet popup or
  // another modal whose transform/backdrop-filter would trap `position:fixed`.
  // Stacking uses the app's documented overlay scale (--z-overlay-raised), which
  // sits above the node detail modal and the map's Leaflet panes/controls.
  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-overlay-raised)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("schedulesFor", { name: nodeName })}
        className="w-full max-w-2xl bg-soil-900 border-2 border-soil-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header — pinned */}
        <div className="flex-none flex items-start justify-between gap-3 px-5 py-4 border-b border-soil-800">
          <div>
            <h3 className="text-lg font-display font-bold text-parchment">
              {editingId ? t("editTitle") : t("listTitle")}
            </h3>
            <p className="text-xs font-mono text-parchment/50 mt-0.5">
              {nodeName} · {nodeId}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("closeAria")}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-parchment/60 hover:text-parchment hover:bg-soil-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {loadError && (
            <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono">
              {loadError}
            </div>
          )}

          {schedules === null ? (
            loadError ? null : <SkeletonBlock className="h-40 w-full" />
          ) : (
            <>
              {schedules.length > 0 && (
                <ul className="space-y-2">
                  {schedules.map((s) =>
                    editingId === s.id ? null : (
                      <li
                        key={s.id}
                        data-schedule-id={s.id}
                        className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border font-mono text-xs ${
                          s.active
                            ? "bg-soil-950/70 border-soil-700"
                            : "bg-soil-950/40 border-soil-800 opacity-70"
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 text-parchment">
                            {s.scheduleType === "recurring" ? (
                              <>
                                <Repeat className="w-3.5 h-3.5 text-olive-400" />
                                <span className="font-bold text-sm">
                                  {s.startTime?.slice(0, 5)} · {s.durationMinutes} min
                                </span>
                              </>
                            ) : (
                              <>
                                <CalendarClock className="w-3.5 h-3.5 text-wheat-400" />
                                <span className="font-bold text-sm">
                                  {formatDateTime(s.scheduledStart)} · {s.durationMinutes} min
                                </span>
                              </>
                            )}
                          </div>
                          <div className="text-parchment/50">
                            {s.scheduleType === "recurring" ? (
                              <>
                                <span>{t("weekly")} </span>
                                <span className="tracking-[0.3em]">
                                  {DAYS.map((d, i) => (
                                    <span
                                      key={i}
                                      className={
                                        s.repeatDays.includes(i) ? "text-olive-400" : "text-parchment/30"
                                      }
                                    >
                                      {d}
                                    </span>
                                  ))}
                                </span>
                              </>
                            ) : (
                              <span>
                                {s.firedAt
                                  ? t("processed", { time: formatDateTime(s.firedAt) })
                                  : t("runsAt", { time: formatDateTime(s.scheduledStart) })}
                              </span>
                            )}
                            <span className="ml-2 inline-flex items-center gap-1">
                              <Layers className="w-3 h-3" />
                              {s.moistureThreshold !== null ? (
                                <span>&lt; {s.moistureThreshold}%</span>
                              ) : (
                                <span className="text-wheat-400">{t("always")}</span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-1 rounded border text-[10px] font-bold uppercase ${
                              s.firedAt
                                ? "bg-olive-600/15 text-olive-400 border-olive-500/30"
                                : s.active
                                  ? "bg-olive-600/20 text-olive-400 border-olive-500/40"
                                  : "bg-soil-800 text-parchment/40 border-soil-700"
                            }`}
                          >
                            {s.firedAt ? t("fired") : s.active ? t("active") : t("paused")}
                          </span>
            {canIrrigate && (
              <>
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                                aria-label={t("editAria", { id: s.id })}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-soil-700 text-parchment/70 hover:text-parchment hover:border-olive-500 transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(s)}
                                aria-label={t("deleteAria", { id: s.id })}
                                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-soil-700 text-clay-400 hover:text-clay-300 hover:border-clay-500 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  )}
                </ul>
              )}

              {schedules.length === 0 && !canIrrigate && (
                <div className="bg-soil-950/40 border-2 border-dashed border-soil-800 rounded-xl p-6 text-center">
                  <p className="font-mono text-sm text-parchment/60">{t("noSchedules")}</p>
                  <p className="text-xs font-sans text-parchment/40 mt-1">
                    {t("noSchedulesSub")}
                  </p>
                </div>
              )}

              {!canIrrigate ? null : (
                <>
                  {editingId && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-wheat-400 flex items-center gap-1.5">
                        <Pencil className="w-3.5 h-3.5" /> {t("editing", { id: editingId.slice(0, 8) })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-[11px] font-mono text-parchment/50 hover:text-parchment underline"
                      >
                        {t("cancelEdit")}
                      </button>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  <form onSubmit={submit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTab("recurring")}
                        aria-pressed={tab === "recurring"}
                        className={`min-h-[48px] rounded-lg border font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                          tab === "recurring"
                            ? "bg-olive-600/20 text-olive-400 border-olive-500/50"
                            : "bg-soil-950 text-parchment/50 border-soil-700 hover:text-parchment"
                        }`}
                      >
                        <Repeat className="w-4 h-4" /> {t("recurring")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab("one_time")}
                        aria-pressed={tab === "one_time"}
                        className={`min-h-[48px] rounded-lg border font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                          tab === "one_time"
                            ? "bg-wheat-600/20 text-wheat-400 border-wheat-500/50"
                            : "bg-soil-950 text-parchment/50 border-soil-700 hover:text-parchment"
                        }`}
                      >
                        <CalendarClock className="w-4 h-4" /> {t("oneTime")}
                      </button>
                    </div>

                    {tab === "recurring" ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <label className="space-y-1 block">
                            <span className="text-[11px] font-mono uppercase text-parchment/70 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {t("startTime")}
                            </span>
                            <input
                              type="time"
                              required
                              value={startTime}
                              onChange={(e) => setStartTime(e.target.value)}
                              className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono focus:outline-none focus:border-olive-400"
                            />
                          </label>
                          <label className="space-y-1 block">
                            <span className="text-[11px] font-mono uppercase text-parchment/70 flex items-center gap-1">
                              <Droplet className="w-3 h-3" /> {t("durationMin")}
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={1440}
                              required
                              value={duration}
                              onChange={(e) => setDuration(Number(e.target.value))}
                              className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono focus:outline-none focus:border-olive-400"
                            />
                          </label>
                          <label className="space-y-1 block">
                            <span className="text-[11px] font-mono uppercase text-parchment/70 flex items-center gap-1">
                              <Layers className="w-3 h-3" /> {t("threshold")}
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              required
                              value={threshold}
                              onChange={(e) => setThreshold(Number(e.target.value))}
                              className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono focus:outline-none focus:border-olive-400"
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          {DAYS.map((d, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => toggleDay(i)}
                              aria-pressed={days.includes(i)}
                              className={`min-w-[44px] min-h-[44px] rounded-lg font-mono text-xs font-bold border transition-colors ${
                                days.includes(i)
                                  ? "bg-olive-600/25 text-olive-400 border-olive-500/50"
                                  : "bg-soil-950 text-parchment/40 border-soil-700"
                              }`}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="space-y-1 block">
                            <span className="text-[11px] font-mono uppercase text-parchment/70 flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {t("start")}
                            </span>
                            <input
                              type="datetime-local"
                              required
                              value={scheduledStart}
                              onChange={(e) => setScheduledStart(e.target.value)}
                              className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono focus:outline-none focus:border-olive-400"
                            />
                          </label>
                          <label className="space-y-1 block">
                            <span className="text-[11px] font-mono uppercase text-parchment/70 flex items-center gap-1">
                              <CalendarClock className="w-3 h-3" /> {t("end")}
                            </span>
                            <input
                              type="datetime-local"
                              required
                              value={scheduledEnd}
                              onChange={(e) => setScheduledEnd(e.target.value)}
                              className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono focus:outline-none focus:border-olive-400"
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-soil-950/70 border border-soil-800 px-3.5 py-2.5">
                          <span className="text-[11px] font-mono uppercase text-parchment/70 flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-wheat-400" /> {t("runDuration")}
                          </span>
                          <span className="font-mono font-bold text-parchment">
                            {scheduledStart && scheduledEnd ? `${oneTimeDuration()} min` : "—"}
                          </span>
                        </div>
                        <label className="flex items-center gap-3 rounded-lg bg-soil-950/70 border border-soil-800 px-3.5 py-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={requireThreshold}
                            onChange={(e) => setRequireThreshold(e.target.checked)}
                            className="w-4 h-4 accent-olive-500"
                          />
                          <span className="flex-1 text-[11px] font-mono uppercase tracking-wider text-parchment/70">
                            {t("requireDry")}
                          </span>
                        </label>
                        {requireThreshold && (
                          <label className="space-y-1 block">
                            <span className="text-[11px] font-mono uppercase text-parchment/70">{t("threshold")}</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={threshold}
                              onChange={(e) => setThreshold(Number(e.target.value))}
                              className="w-full min-h-[48px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono focus:outline-none focus:border-olive-400"
                            />
                          </label>
                        )}
                        {!requireThreshold && (
                          <p className="text-[11px] font-sans text-wheat-400">
                            {t("unconditional")}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={saving}
                        className="min-h-[48px] px-5 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-sm flex items-center gap-2 shadow-md disabled:opacity-60"
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        {editingId ? t("saveChanges") : schedules.length === 0 ? t("createSchedule") : t("addSchedule")}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
          )}
        </div>

        {canIrrigate && (
          <div className="flex-none flex items-center justify-between gap-3 px-5 py-3 border-t border-soil-800">
            <span className="text-[11px] font-mono text-parchment/40">
              {t("footNote")}
            </span>
            <button
              type="button"
              onClick={close}
              className="min-h-[44px] px-4 rounded-lg border border-soil-700 text-parchment/70 hover:text-parchment hover:border-soil-600 font-mono text-xs transition-colors"
            >
              {t("close")}
            </button>
          </div>
        )}

        {deleteTarget && (
          <ConfirmDialog
            isOpen
            title={t("deleteTitle")}
            message={t("deleteScheduleMsg", {
              type: deleteTarget.scheduleType === "recurring" ? t("recurring") : t("oneTime"),
              name: nodeName,
            })}
            confirmText={saving ? t("deleting") : tCommon("delete")}
            cancelText={tCommon("cancel")}
            variant="danger"
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </div>
    </div>,
    document.body
  );
}