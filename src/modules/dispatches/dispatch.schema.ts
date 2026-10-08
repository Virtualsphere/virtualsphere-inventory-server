import { z } from "zod";
import { config } from "../../config";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** Indian GSTIN: 2-digit state code, PAN, entity number, 'Z', checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Most lines one hand-over may have (each line is one module). */
const MAX_ITEMS = 100;

/**
 * One line of a hand-over: a module and which of its units go out — either by
 * id (`unitIds`, e.g. picked by serial) or by `quantity` (oldest first).
 */
const dispatchItemSchema = z
  .object({
    moduleId: z.string().uuid(),
    unitIds: z.array(z.string().uuid()).min(1).max(config.maxIntakeBatch).optional(),
    quantity: z.number().int().min(1).max(config.maxIntakeBatch).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.unitIds && val.quantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select the units to give, or a quantity",
      });
    }
    if (val.unitIds && new Set(val.unitIds).size !== val.unitIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitIds"],
        message: "The same unit is selected twice",
      });
    }
  });

/** The hand-over's own fields, shared by create and edit. */
const headerFields = {
  invoiceNo: z.string().trim().min(1, "Invoice number is required").max(64),
  customerName: z.string().trim().min(1, "Customer name is required").max(200),
  customerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{5,18}$/, "Enter a valid phone number"),
  // Blank means the customer has no GSTIN (unregistered / B2C).
  gstNo: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((s) => (s ? s : null))
    .refine((s) => s === null || GSTIN.test(s), "Enter a valid 15-character GSTIN"),
  givenDate: isoDate,
  validUntil: isoDate.nullish().transform((s) => s ?? null),
  notes: z.string().trim().max(2000),
};

/**
 * Give stock to a customer: one invoice, customer, given date and validity,
 * and one or more modules (`items`). Saved as one record with a line per item.
 */
export const createDispatchSchema = z
  .object({
    ...headerFields,
    notes: headerFields.notes.optional().default(""),
    items: z
      .array(dispatchItemSchema)
      .min(1, "Add at least one product to give")
      .max(MAX_ITEMS),
  })
  .superRefine((val, ctx) => {
    if (val.validUntil && val.validUntil < val.givenDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "Validity date can't be before the given date",
      });
    }
    const modules = val.items.map((i) => i.moduleId);
    if (new Set(modules).size !== modules.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "The same module is added twice — combine those lines",
      });
    }
    const total = val.items.reduce(
      (n, i) => n + (i.unitIds?.length ?? i.quantity ?? 0),
      0,
    );
    if (total > config.maxIntakeBatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: `At most ${config.maxIntakeBatch} units in one hand-over`,
      });
    }
  });

/**
 * PATCH a hand-over's details (not its lines or units). All fields optional;
 * at least one required. The validity check against the given date happens
 * in the service, since either date may come from the stored record.
 */
export const updateDispatchSchema = z
  .object(headerFields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

export const listDispatchesSchema = z.object({
  q: z.string().trim().max(128).optional(),
  moduleId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;
export type UpdateDispatchInput = z.infer<typeof updateDispatchSchema>;
export type DispatchItemInput = CreateDispatchInput["items"][number];
export type ListDispatchesInput = z.infer<typeof listDispatchesSchema>;
