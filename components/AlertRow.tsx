"use client";

import React from "react";
import { Alert } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { useTranslations } from "next-intl";
import { 
  AlertOctagon, 
  AlertTriangle, 
  Info, 
  CheckCheck, 
  Check, 
  MapPin, 
  Clock 
} from "lucide-react";

interface AlertRowProps {
  alert: Alert;
  onAcknowledge: (alertId: string) => void;
}

export function AlertRow({ alert, onAcknowledge }: AlertRowProps) {
  const t = useTranslations("alertRow");
  const getSeverityDetails = () => {
    switch (alert.severity) {
      case "critical":
        return {
          icon: <AlertOctagon className="w-5 h-5 text-clay-400 shrink-0" />,
          label: t("critical"),
          badgeStyle: "bg-clay-600/20 text-clay-400 border-clay-500/40",
          cardBorder: alert.acknowledged ? "border-soil-700/60 opacity-60" : "border-clay-500/50 bg-clay-950/10",
        };
      case "warning":
        return {
          icon: <AlertTriangle className="w-5 h-5 text-wheat-400 shrink-0" />,
          label: t("warning"),
          badgeStyle: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40",
          cardBorder: alert.acknowledged ? "border-soil-700/60 opacity-60" : "border-wheat-500/50 bg-wheat-950/10",
        };
      case "info":
      default:
        return {
          icon: <Info className="w-5 h-5 text-olive-400 shrink-0" />,
          label: t("info"),
          badgeStyle: "bg-olive-600/20 text-olive-400 border-olive-500/40",
          cardBorder: alert.acknowledged ? "border-soil-700/60 opacity-60" : "border-olive-500/50 bg-olive-950/10",
        };
    }
  };

  const severity = getSeverityDetails();

  return (
    <div
      className={`bg-soil-900 border-2 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all shadow-md ${severity.cardBorder}`}
    >
      {/* Alert Details */}
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <div className="p-2 rounded-lg bg-soil-800 border border-soil-700 shrink-0 mt-0.5">
          {severity.icon}
        </div>

        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Multi-modal Severity Badge (Color + Icon + Text) */}
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider border flex items-center gap-1 ${severity.badgeStyle}`}
            >
              {severity.icon}
              <span>{severity.label}</span>
            </span>

            {/* Zone Tag */}
            <span className="inline-flex items-center gap-1 text-xs font-mono text-parchment/70 bg-soil-800 px-2 py-0.5 rounded border border-soil-700">
              <MapPin className="w-3 h-3 text-parchment/50" />
              <span>{alert.zoneName ?? t("farmWide")}</span>
            </span>

            {alert.nodeId && (
              <span className="text-xs font-mono text-olive-400 bg-olive-950/40 px-2 py-0.5 rounded border border-olive-800/40">
                {alert.nodeId}
              </span>
            )}
          </div>

          <p className="text-sm sm:text-base font-sans text-parchment font-medium leading-snug">
            {alert.message}
          </p>

          <div className="flex items-center gap-3 text-xs font-mono text-parchment/60 flex-wrap">
            <span className="flex items-center gap-1" title={alert.triggeredAt}>
              <Clock className="w-3.5 h-3.5" />
              {timeAgo(alert.triggeredAt)}
            </span>
            {alert.value !== null && alert.value !== undefined && (
              <span className="text-parchment/80">
                {t("recordedValue")} <strong className="text-parchment">{alert.value}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Acknowledge Action (Min 48px touch target) */}
      <div className="w-full sm:w-auto flex justify-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-soil-800">
        {alert.acknowledged ? (
          <div className="min-h-[48px] px-4 py-2 rounded-lg bg-soil-800/60 border border-soil-700/60 text-parchment/50 text-xs font-mono flex items-center gap-2 select-none">
            <CheckCheck className="w-4 h-4 text-olive-400" />
            <span>{t("acknowledged")}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onAcknowledge(alert.id)}
            className="w-full sm:w-auto min-h-[48px] px-5 py-2.5 rounded-lg bg-soil-800 hover:bg-soil-700 active:bg-soil-600 text-parchment border border-soil-600 hover:border-olive-500 font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm"
          >
            <Check className="w-4 h-4 text-olive-400" />
            <span>{t("acknowledge")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
