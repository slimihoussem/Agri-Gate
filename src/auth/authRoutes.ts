import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ValidationError } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import { requireAuth } from "./authMiddleware";
import { login, updateUserPreferences, SESSION_COOKIE } from "./authService";
import type { Language, Theme } from "./authService";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // keep in sync with authService

/**
 * Auth routes — Part 10.
 *   POST   /api/auth/login               (public)
 *   POST   /api/auth/logout              (public — clears cookie; harmless when logged out)
 *   GET    /api/auth/me                  (requires session)
 *   PATCH  /api/auth/me/preferences      (requires session — any role)
 */
const router = Router();

const loginBodySchema = z.object({
  email: z.string().trim().email("email must be a valid address"),
  password: z.string().min(1, "password is required"),
});

router.post(
  "/login",
  validateRequest({ source: "body", schema: loginBodySchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
      const { token, user } = await login(email, password);

      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production", // SameSite=None requires HTTPS
        maxAge: TOKEN_TTL_SECONDS * 1000,
        path: "/",
      });

      // Token also returned for Bearer-style clients (curl verification).
      res.json({ user, token });
    } catch {
      // Uniform failure shape — no hint about which field was wrong.
      throw new ValidationError("Invalid email or password", [
        { path: "credentials", message: "Invalid email or password" },
      ]);
    }
  })
);

router.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store"); // identity must never come from cache
  res.json({ user: req.user });
});

// Personal UI preferences — ANY authenticated role may change their own
// language/theme (not permission-gated). Updates only the caller's row.
const preferencesSchema = z
  .object({
    language: z.enum(["en", "fr", "ar"]).optional(),
    theme: z.enum(["dark", "light"]).optional(),
  })
  .refine((v) => v.language !== undefined || v.theme !== undefined, {
    message: "provide at least one of language or theme",
  });

router.patch(
  "/me/preferences",
  requireAuth,
  validateRequest({ source: "body", schema: preferencesSchema }),
  asyncHandler(async (req, res) => {
    const { language, theme } = req.body as {
      language?: Language;
      theme?: Theme;
    };
    const updated = await updateUserPreferences(req.user!.id, { language, theme });
    res.json({ user: updated });
  })
);

export default router;
