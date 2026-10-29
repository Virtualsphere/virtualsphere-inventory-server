import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import { categorySchema } from "./category.schema";
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from "./category.service";

export const tagCategoryRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid category id") });

// GET /api/tag-categories   (with how many tags each has)
tagCategoryRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listCategories());
  }),
);

// POST /api/tag-categories   (admin only)
tagCategoryRoutes.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parse(categorySchema, req.body);
    res.status(201).json(await createCategory(input));
  }),
);

// PATCH /api/tag-categories/:id   (admin only; rename)
tagCategoryRoutes.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(categorySchema, req.body);
    res.json(await renameCategory(id, input));
  }),
);

// DELETE /api/tag-categories/:id   (admin only; refused while it has tags)
tagCategoryRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteCategory(id);
    res.status(204).end();
  }),
);
