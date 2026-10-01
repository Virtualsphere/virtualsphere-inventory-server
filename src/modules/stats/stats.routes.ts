import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { getStats } from "./stats.repo";

export const statsRoutes = Router();

// GET /api/stats   (dashboard totals + low-stock products)
statsRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getStats());
  }),
);
