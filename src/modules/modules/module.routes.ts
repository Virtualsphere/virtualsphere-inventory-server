import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import {
  createModuleSchema,
  listModulesSchema,
  updateModuleSchema,
} from "./module.schema";
import {
  createModule,
  deleteModule,
  getModule,
  listModules,
  updateModule,
} from "./module.service";
import { listUnitsForModule } from "../units/unit.service";

export const moduleRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid module id") });

// GET /api/modules   (optional ?productId= to list one product's modules)
moduleRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const { productId } = parse(listModulesSchema, req.query);
    res.json(await listModules(productId));
  }),
);

// POST /api/modules
moduleRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(createModuleSchema, req.body);
    res.status(201).json(await createModule(input));
  }),
);

// GET /api/modules/:id   (module + unit counts)
moduleRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getModule(id));
  }),
);

// GET /api/modules/:id/units   (all units of this module)
moduleRoutes.get(
  "/:id/units",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await listUnitsForModule(id));
  }),
);

// PATCH /api/modules/:id
moduleRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(updateModuleSchema, req.body);
    res.json(await updateModule(id, patch));
  }),
);

// DELETE /api/modules/:id   (admin only; cascades to its units)
moduleRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteModule(id);
    res.status(204).end();
  }),
);
