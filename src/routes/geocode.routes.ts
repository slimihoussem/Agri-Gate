import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";

/**
 * Mounted at /api/geocode in server.ts (behind requireAuth — only logged-in
 * users use the Farm Map).
 *
 * Nominatim's free tier requires a real User-Agent presented server-side;
 * browsers cannot set the User-Agent header (it is a forbidden header), so a
 * direct client-side call is unreliable and can be rejected. This endpoint
 * proxies the geocoding lookup so the User-Agent is always set correctly.
 */
const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "Missing query" });
      return;
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        headers: { "User-Agent": "AgriGate/1.0" },
      });
    } catch {
      res.status(502).json({ error: "Geocoding service unavailable" });
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Geocoding service error (${upstream.status})` });
      return;
    }

    const data = (await upstream.json()) as
      | { lat?: string; lon?: string; display_name?: string }[]
      | unknown;

    const hit = Array.isArray(data) ? data[0] : undefined;
    if (hit && typeof hit.lat === "string" && typeof hit.lon === "string") {
      res.json({
        lat: parseFloat(hit.lat),
        lon: parseFloat(hit.lon),
        label: typeof hit.display_name === "string" ? hit.display_name : null,
      });
      return;
    }

    res.status(404).json({ error: "Not found" });
  })
);

export default router;
