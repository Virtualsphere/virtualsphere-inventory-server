import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import {
  intakeSchema,
  listUnitsSchema,
  unitStatusSchema,
  updateUnitSchema,
} from "./unit.schema";
import {
  exportUnitsCsv,
  getUnit,
  intake,
  listUnitsPaged,
  updateUnit,
} from "./unit.service";

export const unitRoutes = Router();

const idParam = z.object({ id: z.string().uuid("invalid unit id") });

const exportQuery = z.object({
  q: z.string().trim().max(128).optional(),
  moduleId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: unitStatusSchema.optional(),
});

// GET /api/units  (paged, filterable, searchable)
unitRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(listUnitsSchema, req.query);
    res.json(await listUnitsPaged(input));
  }),
);

// GET /api/units/export.csv   (declared before /:id so it isn't captured by it)
unitRoutes.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const filters = parse(exportQuery, req.query);
    const csv = await exportUnitsCsv(filters);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="stockroom-units-${stamp}.csv"`,
    );
    res.send(csv);
  }),
);

// POST /api/units/intake   (batch create units with transactional serials)
unitRoutes.post(
  "/intake",
  asyncHandler(async (req, res) => {
    const input = parse(intakeSchema, req.body);
    res.status(201).json(await intake(input));
  }),
);

// GET /api/units/:id
unitRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getUnit(id));
  }),
);

// PATCH /api/units/:id   (status change, sale details, fix serial, notes)
unitRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(updateUnitSchema, req.body);
    res.json(await updateUnit(id, patch));
  }),
);
