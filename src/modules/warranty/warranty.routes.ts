import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { computeWarranty } from "../../lib/warranty";
import {
  findUnitBySerial,
  suggestUnitsBySerial,
} from "../units/unit.repo";

export const warrantyRoutes = Router();

const lookupQuery = z.object({
  serial: z.string().trim().min(1).max(128),
});

// GET /api/warranty?serial=...   (match EITHER serial, case-insensitively)
warrantyRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const { serial } = parse(lookupQuery, req.query);
    const unit = await findUnitBySerial(serial);

    if (!unit) {
      const suggestions = await suggestUnitsBySerial(serial);
      res.status(404).json({
        found: false,
        serial,
        suggestions: suggestions.map((s) => ({
          id: s.id,
          internalSerial: s.internalSerial,
          manufacturerSerial: s.manufacturerSerial,
          productName: s.productName,
          moduleName: s.moduleName,
          sku: s.sku,
          status: s.status,
        })),
      });
      return;
    }

    const matchedBy =
      unit.internalSerial.toLowerCase() === serial.trim().toLowerCase()
        ? "internal"
        : "manufacturer";

    res.json({
      found: true,
      matchedBy,
      unit,
      warranty: computeWarranty({
        warrantyStart: unit.warrantyStart,
        intakeDate: unit.intakeDate,
        warrantyMonths: unit.warrantyMonths,
      }),
    });
  }),
);
