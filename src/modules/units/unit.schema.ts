import { z } from "zod";
import { config } from "../../config";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

// Literal enum — its inferred type is exactly the UnitStatus union.
export const unitStatusSchema = z.enum([
  "in_stock",
  "sold",
  "returned",
  "defective",
]);

const manufacturerSerial = z.string().trim().min(1).max(128);
const internalSerial = z.string().trim().min(1).max(128);
/** A per-unit serial in a batch: null or "" means "none / generate". */
const optionalSerial = z
  .string()
  .trim()
  .max(128)
  .nullable()
  .transform((s) => (s ? s : null));

/**
 * Intake: add units to a product. Two modes —
 *  - `manufacturerSerials` only: one supplier serial per unit (count = array
 *    length); every entry must be present
 *  - `quantity`: N units. `manufacturerSerials` may also be sent, then it
 *    gives supplier serials for the first units; null/"" entries (and units
 *    past the end of the array) get no supplier serial
 * Optional `internalSerials` overrides the generated internal serial per unit
 * (same order as the units; null or "" keeps the generated one).
 */
export const intakeSchema = z
  .object({
    productId: z.string().uuid(),
    manufacturerSerials: z.array(optionalSerial).optional(),
    quantity: z.number().int().min(1).max(config.maxIntakeBatch).optional(),
    internalSerials: z.array(optionalSerial).optional(),
    intakeDate: isoDate.optional(),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .superRefine((val, ctx) => {
    const hasSerials =
      Array.isArray(val.manufacturerSerials) &&
      val.manufacturerSerials.length > 0;
    const hasQty = typeof val.quantity === "number";

    if (!hasSerials && !hasQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide a non-empty manufacturerSerials array or a quantity",
      });
      return;
    }

    if (hasSerials) {
      const serials = val.manufacturerSerials!;
      const max = hasQty ? val.quantity! : config.maxIntakeBatch;
      if (serials.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manufacturerSerials"],
          message: hasQty
            ? "More manufacturer serials than the quantity"
            : `At most ${config.maxIntakeBatch} serials per intake`,
        });
      }
      if (!hasQty && serials.some((s) => !s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manufacturerSerials"],
          message: "Serials cannot be empty (use quantity for units without one)",
        });
      }
      // Reject duplicates within the batch (case-insensitive).
      const seen = new Set<string>();
      for (const s of serials) {
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["manufacturerSerials"],
            message: `Duplicate serial in batch: "${s}"`,
          });
          break;
        }
        seen.add(key);
      }
    }

    if (val.internalSerials) {
      const count = hasQty ? val.quantity! : val.manufacturerSerials!.length;
      if (val.internalSerials.length > count) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["internalSerials"],
          message: "More internal serials than units",
        });
      }
      const seen = new Set<string>();
      for (const s of val.internalSerials) {
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["internalSerials"],
            message: `Duplicate internal serial in batch: "${s}"`,
          });
          break;
        }
        seen.add(key);
      }
    }
  });

/** PATCH a single unit. All fields optional; at least one required. */
export const updateUnitSchema = z
  .object({
    status: unitStatusSchema,
    internalSerial,
    manufacturerSerial: manufacturerSerial.nullable(),
    soldTo: z.string().trim().max(200).nullable(),
    soldDate: isoDate.nullable(),
    warrantyStart: isoDate.nullable(),
    warrantyMonths: z.number().int().min(0).max(1200),
    notes: z.string().trim().max(2000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

/** Query params for listing units. */
export const listUnitsSchema = z.object({
  q: z.string().trim().max(128).optional(),
  productId: z.string().uuid().optional(),
  status: unitStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(["newest", "oldest", "serial"]).optional().default("newest"),
});

export type IntakeInput = z.infer<typeof intakeSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type ListUnitsInput = z.infer<typeof listUnitsSchema>;
