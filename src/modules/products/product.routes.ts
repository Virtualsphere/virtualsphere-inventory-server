import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import {
  createProductSchema,
  updateProductSchema,
} from "./product.schema";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "./product.service";
import { listModules } from "../modules/module.service";

export const productRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid product id") });

// GET /api/products   (with module / unit counts)
productRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listProducts());
  }),
);

// POST /api/products
productRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(createProductSchema, req.body);
    res.status(201).json(await createProduct(input));
  }),
);

// GET /api/products/:id   (product + counts)
productRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getProduct(id));
  }),
);

// GET /api/products/:id/modules   (this product's modules, with unit counts)
productRoutes.get(
  "/:id/modules",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await getProduct(id); // 404 for an unknown product rather than []
    res.json(await listModules(id));
  }),
);

// PATCH /api/products/:id
productRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(updateProductSchema, req.body);
    res.json(await updateProduct(id, patch));
  }),
);

// DELETE /api/products/:id   (admin only; refused while it has modules)
productRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteProduct(id);
    res.status(204).end();
  }),
);
