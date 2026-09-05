"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X, Check } from "lucide-react";
import { useTranslations } from "next-intl";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "warning" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  /** Hide the confirm button entirely — for informational dialogs (e.g. an
   *  unoverridable block shown to farmers). */
  hideConfirm?: boolean;
  /** Optional body rendered between the message and the action buttons. */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = "primary",
  onConfirm,
  onCancel,
  hideConfirm = false,
  children,
}: ConfirmDialogProps) {
  const t = useTranslations("confirmDialog");
  const tCommon = useTranslations("common");
  const confirmLabel = confirmText ?? tCommon("confirmAction");
  const cancelLabel = cancelText ?? tCommon("cancel");
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const getConfirmStyle = () => {
    switch (variant) {
      case "danger":
        return "bg-clay-500 hover:bg-clay-600 text-parchment border-clay-400";
      case "warning":
        return "bg-wheat-500 hover:bg-wheat-600 text-soil-950 border-wheat-400";
      case "primary":
      default:
        return "bg-olive-500 hover:bg-olive-600 text-parchment border-olive-400";
    }
  };

  // Portal to <body> so the dialog always stacks above whatever opened it —
  // including the map's Leaflet popups/controls and any parent modal that uses
  // a transform/backdrop-filter (which would otherwise trap `position:fixed`).
  // z-index comes from the app's documented overlay scale (--z-overlay-top).
  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-overlay-top)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        className="w-full max-w-md bg-soil-900 border-2 border-soil-700 rounded-xl shadow-2xl overflow-hidden p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-soil-800 border border-soil-700 text-wheat-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 id="dialog-title" className="text-xl font-display font-semibold text-parchment">
              {title}
            </h2>
          </div>
          <button
            onClick={onCancel}
            aria-label={t("closeAria")}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-lg text-parchment/60 hover:text-parchment hover:bg-soil-800 border border-transparent hover:border-soil-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        <p className="text-sm sm:text-base text-parchment/80 leading-relaxed font-sans">
          {message}
        </p>

        {/* Optional body (e.g. a duration input) */}
        {children}

        {/* Actions (Min 48px touch targets) */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-medium transition-colors text-sm"
          >
            {cancelLabel}
          </button>
          {!hideConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              className={`w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-lg border font-semibold flex items-center justify-center gap-2 transition-all shadow-md text-sm ${getConfirmStyle()}`}
            >
              <Check className="w-4 h-4" />
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

