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
import { listUnitsForProduct } from "../units/unit.service";

export const productRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid product id") });

// GET /api/products
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

// GET /api/products/:id   (product + unit counts)
productRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getProduct(id));
  }),
);

// GET /api/products/:id/units   (all units of this product)
productRoutes.get(
  "/:id/units",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await listUnitsForProduct(id));
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

// DELETE /api/products/:id   (admin only; cascades to its units)
productRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteProduct(id);
    res.status(204).end();
  }),
);
