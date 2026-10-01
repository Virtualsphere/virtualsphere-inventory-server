import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAdmin } from "../../middleware/auth";
import { parse } from "../../lib/validate";
import { getSettings, updateSettings } from "./settings.repo";
import { updateSettingsSchema } from "./settings.schema";

export const settingsRoutes = Router();

// GET /api/settings
settingsRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  }),
);

// PUT /api/settings   (admin only)
settingsRoutes.put(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parse(updateSettingsSchema, req.body);
    res.json(await updateSettings(input));
  }),
);
