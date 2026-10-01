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

/**
 * Intake: add units to a product. Two mutually exclusive modes —
 *  - `manufacturerSerials`: one supplier serial per unit (count = array length)
 *  - `quantity`: N units whose supplier serial is unknown at intake
 */
export const intakeSchema = z
  .object({
    productId: z.string().uuid(),
    manufacturerSerials: z.array(manufacturerSerial).optional(),
    quantity: z.number().int().min(1).max(config.maxIntakeBatch).optional(),
    intakeDate: isoDate.optional(),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .superRefine((val, ctx) => {
    const hasSerials =
      Array.isArray(val.manufacturerSerials) &&
      val.manufacturerSerials.length > 0;
    const hasQty = typeof val.quantity === "number";

    if (hasSerials === hasQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either a non-empty manufacturerSerials array or a quantity, but not both",
      });
      return;
    }

    if (hasSerials) {
      const serials = val.manufacturerSerials!;
      if (serials.length > config.maxIntakeBatch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manufacturerSerials"],
          message: `At most ${config.maxIntakeBatch} serials per intake`,
        });
      }
      // Reject duplicates within the batch (case-insensitive).
      const seen = new Set<string>();
      for (const s of serials) {
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
  });

/** PATCH a single unit. All fields optional; at least one required. */
export const updateUnitSchema = z
  .object({
    status: unitStatusSchema,
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
