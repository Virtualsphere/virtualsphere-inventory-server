import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { requireAdmin } from "../../middleware/auth";
import { parse } from "../../lib/validate";
import { getSettings, updateSettings } from "./settings.repo";
import { updateSettingsSchema } from "./settings.schema";
import { syncNextSeq } from "../units/unit.service";

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
    const settings = await updateSettings(input);
    // The global prefix is part of every module's generated serials.
    if (input.serialPrefix !== undefined) await syncNextSeq();
    res.json(settings);
  }),
);
