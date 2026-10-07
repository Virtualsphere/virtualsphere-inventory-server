import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import {
  createDispatchSchema,
  listDispatchesSchema,
} from "./dispatch.schema";
import {
  createDispatch,
  deleteDispatch,
  getDispatch,
  listDispatchesPaged,
} from "./dispatch.service";

export const dispatchRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid dispatch id") });

// GET /api/dispatches   (paged; search invoice, customer, phone, GSTIN, product, serial)
dispatchRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(listDispatchesSchema, req.query);
    res.json(await listDispatchesPaged(input));
  }),
);

// POST /api/dispatches   (give stock to a customer; marks the units sold)
dispatchRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(createDispatchSchema, req.body);
    res.status(201).json(await createDispatch(input, req.user?.id ?? null));
  }),
);

// GET /api/dispatches/:id   (record + the units that went out)
dispatchRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getDispatch(id));
  }),
);

// DELETE /api/dispatches/:id   (admin only; puts the units back in stock)
dispatchRoutes.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteDispatch(id);
    res.status(204).end();
  }),
);
