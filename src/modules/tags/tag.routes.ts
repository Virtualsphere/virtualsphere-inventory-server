import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import { addTagStockSchema, createTagSchema, updateTagSchema } from "./tag.schema";
import {
  addTagStock,
  createTag,
  deleteTag,
  deleteTagIntake,
  getTag,
  listTags,
  updateTag,
} from "./tag.service";

export const tagRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid tag id") });
const intakeParam = idParam.extend({
  intakeId: z.string().uuid("invalid stock entry id"),
});

// GET /api/tags   (with in stock / added / given totals)
tagRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listTags());
  }),
);

// POST /api/tags   (optionally with a first quantity)
tagRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(createTagSchema, req.body);
    res.status(201).json(await createTag(input, req.user?.id ?? null));
  }),
);

// GET /api/tags/:id   (tag + stock intakes + where it was given)
tagRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getTag(id));
  }),
);

// PATCH /api/tags/:id   (name, description)
tagRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(updateTagSchema, req.body);
    res.json(await updateTag(id, patch));
  }),
);

// DELETE /api/tags/:id   (admin only; refused once it has been given out)
tagRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteTag(id);
    res.status(204).end();
  }),
);

// POST /api/tags/:id/stock   (add a quantity)
tagRoutes.post(
  "/:id/stock",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(addTagStockSchema, req.body);
    res.status(201).json(await addTagStock(id, input, req.user?.id ?? null));
  }),
);

// DELETE /api/tags/:id/stock/:intakeId   (admin only; undo a mistaken intake)
tagRoutes.delete(
  "/:id/stock/:intakeId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id, intakeId } = parse(intakeParam, req.params);
    res.json(await deleteTagIntake(id, intakeId));
  }),
);
