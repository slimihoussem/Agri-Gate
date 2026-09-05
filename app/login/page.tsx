"use client";

import React, { useState } from "react";
import { login } from "@/lib/api";
import { applyUserPreferences } from "@/lib/preferences";
import { useTranslations } from "next-intl";
import { AlertTriangle, Radio, Loader2 } from "lucide-react";

/**
 * Login page — Part 10 + Part 21.
 * Posts credentials to /api/auth/login; the API sets an httpOnly session
 * cookie and middleware lets the user into protected pages afterwards.
 * The returned user row carries saved language/theme — applyUserPreferences()
 * pushes them into cookie + localStorage (see lib/preferences.tsx) BEFORE the
 * redirect so the next page renders in the user's language from first paint.
 */
export default function LoginPage() {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login(email.trim(), password);
      // Clear any stale farm context from a previous session — every fresh
      // login starts clean (staff → hub, farmer → dashboard).
      sessionStorage.removeItem("agrigate_farm_context");
      sessionStorage.removeItem("agrigate_farm_history");
      // Apply the user's saved UI preferences (cookie + localStorage).
      applyUserPreferences(loggedIn);
      // Part 14: role-based landing — staff → hub, farmer → dashboard.
      const dest = loggedIn.role === "admin" ? "/admin" : loggedIn.role === "technician" ? "/technician" : "/dashboard";
      window.location.assign(dest);
    } catch (err) {
      setError((err as Error).message || t("failed"));
      setSubmitting(false);
    }
  };

  return (
        <div className="min-h-screen w-full bg-soil-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-soil-900 border-2 border-soil-700 items-center justify-center text-olive-400 shadow-xl">
            <Radio className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-display font-bold text-parchment">AgriGate</h1>
          <p className="text-sm text-parchment/60 font-sans">
            {t("tagline")}
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-soil-900 border-2 border-soil-700 rounded-2xl p-7 shadow-2xl space-y-5"
        >
          <div>
            <h2 className="text-lg font-display font-bold text-parchment">{t("signIn")}</h2>
            <p className="text-xs text-parchment/60 font-sans mt-0.5">
              {t("useOperatorAccount")}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono font-medium flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-mono uppercase tracking-wider text-parchment/80">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400 font-sans"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-mono uppercase tracking-wider text-parchment/80">
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className="w-full min-h-[48px] px-4 rounded-lg bg-soil-950 border border-soil-700 text-parchment text-sm focus:outline-none focus:border-olive-400 font-sans"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] px-6 py-2.5 rounded-lg bg-olive-500 hover:bg-olive-600 active:bg-olive-700 text-soil-950 font-mono font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-60 disabled:hover:bg-olive-500"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                <span>{t("signingIn")}</span>
              </>
            ) : (
              <span>{t("signIn")}</span>
            )}
          </button>
        </form>

        <p className="text-center text-[11px] font-mono text-parchment/40">
          {t("accessNote")}
        </p>
      </div>
    </div>
  );
}
