import type { Language, Theme } from "@/lib/api";

/**
 * Server-safe subset of the UI-preferences module.
 *
 * The provider (`lib/preferences.tsx`) must be a `"use client"` module, which
 * makes its runtime exports unavailable to Server Components (calling them
 * there yields "parsePrefsCookie is not a function"). The pure constants and
 * the cookie parser that the root layout needs on the server live HERE so
 * first-paint language/theme resolution never crosses a client boundary.
 */

export const LANG_KEY = "agrigate_lang";
export const THEME_KEY = "agrigate_theme";
export const PREFS_COOKIE = "agrigate_prefs";

export const SUPPORTED_LANGUAGES: Language[] = ["en", "fr", "ar"];
export const THEMES: Theme[] = ["dark", "light"];

export function parsePrefsCookie(
  raw: string | undefined
): { language: Language; theme: Theme } {
  // shape: v1.<lang>.<theme>  (defensive — ignore anything malformed)
  const m = raw?.match(/^v1\.(en|fr|ar)\.(dark|light)$/);
  return {
    language: m ? (m[1] as Language) : "en",
    theme: m ? (m[2] as Theme) : "dark",
  };
}