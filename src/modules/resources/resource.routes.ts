import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import {
  addResourceStockSchema,
  createResourceSchema,
  updateResourceSchema,
} from "./resource.schema";
import {
  addResourceStock,
  createResource,
  deleteResource,
  deleteResourceIntake,
  getResource,
  listResources,
  updateResource,
} from "./resource.service";

export const resourceRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid resource id") });
const intakeParam = idParam.extend({
  intakeId: z.string().uuid("invalid stock entry id"),
});

// GET /api/resources   (with in stock / added / used totals)
resourceRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listResources());
  }),
);

// POST /api/resources   (optionally with a first quantity)
resourceRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(createResourceSchema, req.body);
    res.status(201).json(await createResource(input, req.user?.id ?? null));
  }),
);

// GET /api/resources/:id   (resource + stock intakes + usage by module)
resourceRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getResource(id));
  }),
);

// PATCH /api/resources/:id   (name, description)
resourceRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(updateResourceSchema, req.body);
    res.json(await updateResource(id, patch));
  }),
);

// DELETE /api/resources/:id   (admin only; refused once units use it)
resourceRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteResource(id);
    res.status(204).end();
  }),
);

// POST /api/resources/:id/stock   (add a quantity)
resourceRoutes.post(
  "/:id/stock",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(addResourceStockSchema, req.body);
    res.status(201).json(await addResourceStock(id, input, req.user?.id ?? null));
  }),
);

// DELETE /api/resources/:id/stock/:intakeId   (admin only; undo a mistaken intake)
resourceRoutes.delete(
  "/:id/stock/:intakeId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id, intakeId } = parse(intakeParam, req.params);
    res.json(await deleteResourceIntake(id, intakeId));
  }),
);
