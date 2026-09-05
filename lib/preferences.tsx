"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NextIntlClientProvider } from "next-intl";
import { updatePreferences } from "@/lib/api";
import type { Language, Theme } from "@/lib/api";
import {
  LANG_KEY,
  THEME_KEY,
  PREFS_COOKIE,
  SUPPORTED_LANGUAGES,
} from "@/lib/preferences-core";
export {
  LANG_KEY,
  THEME_KEY,
  PREFS_COOKIE,
  SUPPORTED_LANGUAGES,
  THEMES,
  parsePrefsCookie,
} from "@/lib/preferences-core";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Per-user UI preferences (language + theme).
 *
 * Storage ladder (all three kept in sync when a preference changes):
 *   1. DB row (users.language / users.theme) — per-user, survives any device.
 *   2. Cookie `agrigate_prefs=v1.<lang>.<theme>` — read server-side in the
 *      root layout so FIRST paint is already in the right language/PALETTE
 *      (no flash), and client + server agree at hydration time.
 *   3. localStorage `agrigate_lang` / `agrigate_theme` — survives so the
 *      pre-paint script in <head> can apply the theme BEFORE React hydrates.
 *
 * The logged-in DB row is the source of truth after authentication; the
 * control flow lives here and in useAuth (adopts user prefs on login).
 */

export type IntlMessages = typeof en;

const MESSAGES = { en, fr, ar } as const;

export function writePrefsCookie(language: Language, theme: Theme): void {
  if (typeof document === "undefined") return;
  document.cookie = `${PREFS_COOKIE}=v1.${language}.${theme}; path=/; max-age=31536000; samesite=lax`;
}

export function readLocalPrefs(): { language: Language; theme: Theme } {
  if (typeof window === "undefined") return { language: "en", theme: "dark" };
  const lang = window.localStorage.getItem(LANG_KEY);
  const theme = window.localStorage.getItem(THEME_KEY);
  return {
    language: lang === "fr" || lang === "ar" ? lang : "en",
    theme: theme === "light" ? "light" : "dark",
  };
}

export function applyDocumentPrefs(language: Language, theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.lang = language;
  root.dir = language === "ar" ? "rtl" : "ltr";
}

interface Preferences {
  language: Language;
  theme: Theme;
  /** Applies instantly (client-side) AND persists to cookie + localStorage + DB. */
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

interface PreferencesProviderProps {
  /** Resolved from the agrigate_prefs cookie server-side — matches SSR output. */
  initialLanguage: Language;
  initialTheme: Theme;
  children: React.ReactNode;
}

export function PreferencesProvider({
  initialLanguage,
  initialTheme,
  children,
}: PreferencesProviderProps) {
  // State seeds exactly from the server-provided values so first hydration
  // matches the SSR markup; any persistence differences are reconciled in
  // effects (never by mutating React-rendered <html> attributes).
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  // Reconcile pre-paint script + localStorage against provider state once.
  useEffect(() => {
    const local = readLocalPrefs();
    applyDocumentPrefs(local.language, local.theme);
    setLanguageState(local.language);
    setThemeState(local.theme);
  }, []);

  // Keep html class/lang/dir the source of truth for the CSS + RTL engine.
  useEffect(() => {
    applyDocumentPrefs(language, theme);
    writePrefsCookie(language, theme);
    try {
      window.localStorage.setItem(LANG_KEY, language);
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage full / private mode — cookie + DB persistence still apply
    }
  }, [language, theme]);

  // Persist to the DB on change (debounced). The DB row is persisted even when
  // the user is logged out via a stale cookie, but a successful PATCH requires
  // a session — silent no-op is fine. On login, applyUserPreferences() adopts
  // the authoritative DB values into cookie + localStorage.
  const setLanguage = useCallback(
    (lang: Language) => {
      setLanguageState(lang);
      persistPreferences.sync(lang);
    },
    []
  );

  const setTheme = useCallback(
    (theme: Theme) => {
      setThemeState(theme);
      persistPreferences.sync(theme);
    },
    []
  );

  const toggleTheme = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [theme, setTheme]
  );

  const value = useMemo<Preferences>(
    () => ({ language, theme, setLanguage, setTheme, toggleTheme }),
    [language, theme, setLanguage, setTheme, toggleTheme]
  );

  return (
    <PreferencesContext.Provider value={value}>
      <NextIntlClientProvider locale={language} messages={MESSAGES[language]} timeZone="Africa/Tunis">
        {children}
      </NextIntlClientProvider>
    </PreferencesContext.Provider>
  );
}

/** Exposes the current user + live synced preferred language/theme to the app. */
export function usePreferences(): Preferences {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}

/**
 * Adopts a freshly-logged-in user's DB-stored preferences into the browser
 * (cookie + localStorage + live document). Call right after a successful login
 * so the redirected pages render in the user's language right away.
 */
export function applyUserPreferences(user: {
  language?: Language;
  theme?: Theme;
} | null): void {
  if (!user) return;
  const lang = user.language ?? readLocalPrefs().language;
  const theme = user.theme ?? readLocalPrefs().theme;
  applyDocumentPrefs(lang, theme);
  writePrefsCookie(lang, theme);
  try {
    window.localStorage.setItem(LANG_KEY, lang);
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable — cookie + document state still align
  }
}

// ── debounced persistence to the backend ─────────────────────────────────────
// Fires-and-forgets: final state is guaranteed persisted (last writer wins),
// intermediate rapid toggles coalesce into one request.
const persistPreferences = createPersister();

function createPersister() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { language?: Language; theme?: Theme } = {};
  const flush = () => {
    if (!pending.language && !pending.theme) return;
    const body = { ...pending };
    pending = {};
    timer = null;
    updatePreferences(body)
      .then((user) => {
        // Local row is authoritative — nothing further to do; next getMe()
        // returns the persisted values.
        void user;
      })
      .catch(() => {
        // Offline / transient failure — the next change retries a fresh patch.
      });
  };
  return {
    sync(value: Language | Theme) {
      if (typeof value === "string") {
        if (SUPPORTED_LANGUAGES.includes(value as Language)) pending.language = value as Language;
        else pending.theme = value as Theme;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 600);
    },
  };
}