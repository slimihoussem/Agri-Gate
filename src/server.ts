import * as dotenv from "dotenv";

dotenv.config();

import express, { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requireAuth } from "./auth/authMiddleware";
import authRouter from "./auth/authRoutes";
import farmsRouter from "./routes/farms.routes";
import nodesRouter from "./routes/nodes.routes";
import alertsRouter from "./routes/alerts.routes";
import irrigationRouter from "./routes/irrigation.routes";
import adminRouter from "./routes/admin.routes";
import orgsRouter from "./routes/orgs.routes";
import zonesRouter from "./routes/zones.routes";
import staffRouter from "./routes/staff.routes";
import geocodeRouter from "./routes/geocode.routes";

const app: Express = express();

app.disable("x-powered-by");
// Frontend runs on :3000 while the API is :4000 — reflect origin and allow
// credentials so the httpOnly session cookie flows cross-port in dev.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ── Auth: login/logout/me are the ONLY public /api surface ──────────────────
app.use("/api/auth", authRouter);

// Health stays public (monitoring) — registered before the auth guard.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "agrigate-api", time: new Date().toISOString() });
});

// ── Everything else under /api requires a valid session (Part 10) ───────────
app.use("/api", requireAuth);

// NOTE: role gates are applied per-route inside the routers (technician for
// node registration and schedule mutations). A blanket path-level guard here
// would also block any-role GETs like /api/nodes/:nodeId. Admin remains
// reserved for future user-management endpoints.

app.use("/api/farms", farmsRouter);
app.use("/api/nodes", nodesRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/irrigation", irrigationRouter);
// Platform-admin surface (requirePlatformAdmin inside the router).
app.use("/api/admin", adminRouter);
app.use("/api/orgs", orgsRouter);
app.use("/api/zones", zonesRouter);
app.use("/api/staff", staffRouter);
app.use("/api/geocode", geocodeRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Hosted platforms import the app as a request handler; local/VM execution
// still starts the normal long-running HTTP server.
if (process.env.VERCEL !== "1") {
  const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  app.listen(PORT, () => {
    console.log(`[agrigate-api] listening on http://localhost:${PORT} (auth enabled)`);
  });
}

export default app;
