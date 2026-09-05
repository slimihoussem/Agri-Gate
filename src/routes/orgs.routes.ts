import { z } from "zod";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validateRequest";
import { requireAdminUser } from "../auth/authMiddleware";
import * as farmService from "../services/farmService";

/**
 * Mounted at /api/orgs in server.ts — PLATFORM ADMIN ONLY (Part 11).
 *
 *   POST /api/orgs   onboarding stub: creates a client organization + first
 *                    farm (full staff console arrives in Part 12)
 *   GET  /api/orgs   orgs + their farms (feeds the platform-admin stub table
 *                    in the settings page)
 */
const router = Router();

const createOrgBodySchema = z.object({
  orgName: z.string().trim().min(1, "orgName is required").max(255),
  country: z.string().trim().max(255).optional(),
  region: z.string().trim().max(255).optional(),
  firstFarmName: z.string().trim().min(1, "firstFarmName is required").max(255),
  farmLat: z.number().min(-90).max(90).optional(),
  farmLon: z.number().min(-180).max(180).optional(),
});

/**
 * Part 12: client onboarding — one transaction creating the organization AND
 * its first farm together (no orgless farms, no farmless orgs).
 */
router.post(
  "/",
  requireAdminUser,
  validateRequest({ source: "body", schema: createOrgBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      orgName: string;
      country?: string;
      region?: string;
      firstFarmName: string;
      farmLat?: number;
      farmLon?: number;
    };
    const created = await farmService.createOrganizationWithFarm({
      name: body.orgName,
      farmName: body.firstFarmName,
      location: [body.region, body.country].filter(Boolean).join(", "),
      latitude: body.farmLat ?? null,
      longitude: body.farmLon ?? null,
    });
    res.status(201).json(created);
  })
);

router.get(
  "/",
  requireAdminUser,
  asyncHandler(async (_req, res) => {
    res.json(await farmService.listOrganizationsWithFarms());
  })
);

export default router;
