import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** Most tags one intake or hand-over line may move. */
export const MAX_TAG_QUANTITY = 1_000_000;

const quantity = z.number().int().min(1).max(MAX_TAG_QUANTITY);

// Base field definitions WITHOUT defaults, so the update schema (which is a
// partial of these) never resurrects a default and silently overwrites a field.
const fields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
} as const;

/** Create a tag, optionally with its first stock. */
export const createTagSchema = z.object({
  name: fields.name,
  description: fields.description.optional().default(""),
  quantity: quantity.optional(),
  notes: z.string().trim().max(2000).optional().default(""),
});

export const updateTagSchema = z
  .object(fields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

/** Add stock to a tag: just a quantity. */
export const addTagStockSchema = z.object({
  quantity,
  intakeDate: isoDate.optional(),
  notes: z.string().trim().max(2000).optional().default(""),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type AddTagStockInput = z.infer<typeof addTagStockSchema>;
