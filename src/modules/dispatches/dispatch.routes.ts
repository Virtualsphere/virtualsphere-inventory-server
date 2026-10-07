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
  getDispatchPdf,
  listDispatchesPaged,
} from "./dispatch.service";

export const dispatchRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid dispatch id") });
const pdfQuery = z.object({ download: z.enum(["0", "1"]).optional().transform((v) => v === "1") });

// GET /api/dispatches   (paged; search invoice, customer, phone, GSTIN, product, serial)
dispatchRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(listDispatchesSchema, req.query);
    res.json(await listDispatchesPaged(input));
  }),
);

// POST /api/dispatches   (give stock to a customer: one record, a line per module; marks the units sold)
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

// GET /api/dispatches/:id/pdf   (warranty card; ?download=1 saves instead of viewing)
dispatchRoutes.get(
  "/:id/pdf",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { download } = parse(pdfQuery, req.query);
    const { filename, pdf } = await getDispatchPdf(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${filename}"`,
    );
    res.send(pdf);
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
