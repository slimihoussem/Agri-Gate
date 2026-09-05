"use client";

import React from "react";
import { IrrigationSchedule } from "@/lib/types";
import { 
  Clock, 
  Droplet, 
  Play, 
  Power, 
  Layers, 
  Calendar,
  CalendarClock,
  Zap,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useTranslations } from "next-intl";

interface ScheduleCardProps {
  schedule: IrrigationSchedule;
  onToggleActive: (scheduleId: string) => void;
  onStartNow: (schedule: IrrigationSchedule) => void;
  /** Part 9 ext: hide the zone-era Start button inside per-node rows. */
  canEdit?: boolean;
  hideStart?: boolean;
}

export function ScheduleCard({
  schedule,
  onToggleActive,
  onStartNow,
  canEdit = true,
  hideStart = false,
}: ScheduleCardProps) {
  const t = useTranslations("scheduleCard");
  // Days of the week: 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  const dayLetters = [
    { label: "S", full: t("days.sunday"), dayIndex: 0 },
    { label: "M", full: t("days.monday"), dayIndex: 1 },
    { label: "T", full: t("days.tuesday"), dayIndex: 2 },
    { label: "W", full: t("days.wednesday"), dayIndex: 3 },
    { label: "T", full: t("days.thursday"), dayIndex: 4 },
    { label: "F", full: t("days.friday"), dayIndex: 5 },
    { label: "S", full: t("days.saturday"), dayIndex: 6 },
  ];

  return (
    <div
      className={`rounded-xl border-2 p-5 shadow-xl flex flex-col justify-between gap-5 transition-all ${
        schedule.active
          ? "bg-soil-900 border-soil-700 hover:border-olive-500/60"
          : "bg-soil-950/60 border-soil-800/80 opacity-75 hover:opacity-95"
      }`}
    >
      {/* Top Bar: Zone Name & Active Toggle Switch */}
      <div className="flex items-start justify-between gap-3 border-b border-soil-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-display font-bold text-parchment">
              {schedule.zoneName}
            </h3>
          </div>
          <p className="text-xs font-sans text-parchment/60 mt-0.5">
            {t("sub")}
          </p>
        </div>

        {/* Multi-modal Active Status Toggle (Min 48px target) — technician/admin only */}
        {canEdit ? (
        <button
          type="button"
          onClick={() => onToggleActive(schedule.id)}
          aria-label={t("toggleAria", {
            zoneName: schedule.zoneName,
            state: schedule.active ? t("active") : t("paused"),
          })}
          className={`min-h-[48px] px-3 py-1.5 rounded-lg border font-mono text-xs font-bold flex items-center gap-2 transition-all ${
            schedule.active
              ? "bg-olive-600/20 text-olive-400 border-olive-500/50 hover:bg-olive-600/30"
              : "bg-soil-800 text-parchment/50 border-soil-700 hover:text-parchment hover:border-soil-600"
          }`}
        >
          {schedule.active ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-olive-400" />
              <span>{t("active")}</span>
            </>
          ) : (
            <>
              <XCircle className="w-4 h-4 text-parchment/40" />
              <span>{t("paused")}</span>
            </>
          )}
        </button>
        ) : (
          <span
            title={t("lockedTitle")}
            className="min-h-[48px] px-3 py-1.5 rounded-lg border border-soil-800 bg-soil-950/60 font-mono text-xs text-parchment/40 flex items-center gap-2 select-none"
          >
            {schedule.active ? t("activeLocked") : t("pausedLocked")}
          </span>
        )}
      </div>

      {/* Middle Specs: Start Time, Duration, Trigger */}
      <div className="grid grid-cols-3 gap-2 bg-soil-950/70 p-3.5 rounded-xl border border-soil-800 text-center">
        {/* Start */}
        <div className="space-y-1">
          <span className="text-[11px] font-mono text-parchment/60 uppercase flex items-center justify-center gap-1">
            {schedule.scheduleType === "one_time" ? (
              <CalendarClock className="w-3 h-3 text-wheat-400" />
            ) : (
              <Clock className="w-3 h-3 text-olive-400" />
            )}
            {schedule.scheduleType === "one_time" ? t("run") : t("start")}
          </span>
          <div className="text-sm sm:text-base font-mono font-bold text-parchment">
            {schedule.scheduleType === "one_time"
              ? formatDateTime(schedule.scheduledStart)
              : schedule.startTime?.slice(0, 5)}
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-1 border-x border-soil-800 px-1">
          <span className="text-[11px] font-mono text-parchment/60 uppercase flex items-center justify-center gap-1">
            <Droplet className="w-3 h-3 text-wheat-400" /> {t("duration")}
          </span>
          <div className="text-sm sm:text-base font-mono font-bold text-parchment">
            {schedule.durationMinutes} <span className="text-xs font-normal text-parchment/60">{t("min")}</span>
          </div>
        </div>

        {/* Trigger */}
        <div className="space-y-1">
          <span className="text-[11px] font-mono text-parchment/60 uppercase flex items-center justify-center gap-1">
            <Layers className="w-3 h-3 text-olive-400" /> {t("trigger")}
          </span>
          <div className="text-sm sm:text-base font-mono font-bold text-parchment">
            {schedule.firedAt ? (
              <span className="text-olive-400">{t("done")}</span>
            ) : schedule.moistureThreshold === null ? (
              <span className="text-wheat-400 inline-flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" /> {t("always")}
              </span>
            ) : (
              `< ${schedule.moistureThreshold}%`
            )}
          </div>
        </div>
      </div>

      {/* Repeat Days / one-time status */}
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-wider text-parchment/60 flex items-center gap-1.5">
          {schedule.scheduleType === "one_time" ? (
            <Zap className="w-3.5 h-3.5 text-wheat-400" />
          ) : (
            <Calendar className="w-3.5 h-3.5" />
          )}
          <span>{schedule.scheduleType === "one_time" ? t("oneTimeRun") : t("repeatFrequency")}</span>
        </div>

        {schedule.scheduleType === "recurring" ? (
          <div className="flex items-center justify-between gap-1">
            {dayLetters.map((day) => {
              const isSelected = schedule.repeatDays.includes(day.dayIndex);

              return (
                <div
                  key={day.dayIndex}
                  title={day.full}
                  className={`min-w-[36px] sm:min-w-[42px] min-h-[44px] sm:min-h-[48px] rounded-lg font-mono font-bold text-xs sm:text-sm flex items-center justify-center border transition-all select-none ${
                    isSelected
                      ? "bg-olive-500 text-soil-950 border-olive-400 shadow-md font-extrabold"
                      : "bg-soil-800/80 text-parchment/40 border-soil-700/60"
                  }`}
                >
                  {day.label}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-parchment/60">
              {t("ends", { date: formatDateTime(schedule.scheduledEnd) })}
            </span>
            <span
              className={`px-2 py-1 rounded border text-[10px] font-mono font-bold uppercase ${
                schedule.firedAt
                  ? "bg-olive-600/15 text-olive-400 border-olive-500/30"
                  : schedule.active
                    ? "bg-wheat-600/15 text-wheat-400 border-wheat-500/30"
                    : "bg-soil-800 text-parchment/40 border-soil-700"
              }`}
            >
              {schedule.firedAt ? t("fired") : schedule.active ? t("scheduled") : t("paused")}
            </span>
          </div>
        )}
      </div>

      {/* Action: "Start Now" — hidden in per-node context (row has Open/Close) */}
      {!hideStart && (
        <div className="pt-2 border-t border-soil-800">
          <button
            type="button"
            onClick={() => onStartNow(schedule)}
            className="w-full min-h-[48px] px-4 py-3 rounded-lg bg-soil-800 hover:bg-soil-700 active:bg-soil-600 text-parchment border border-soil-600 hover:border-olive-500 font-mono text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md group"
          >
            <Play className="w-4 h-4 text-olive-400 group-hover:scale-110 transition-transform fill-olive-400" />
            <span>{t("manualTrigger")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
