import { z } from "zod";

const prefix = z
  .string()
  .trim()
  .max(16)
  .regex(/^[A-Za-z0-9]*$/, "prefix must be alphanumeric")
  .transform((s) => s.toUpperCase());

// Base field definitions WITHOUT defaults, so the update schema (which is a
// partial of these) never resurrects a default and silently overwrites a field.
const fields = {
  name: z.string().trim().min(1).max(200),
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "SKU may contain letters, digits, . _ -"),
  description: z.string().trim().max(2000),
  warrantyMonths: z.number().int().min(0).max(1200),
  // null clears the per-product override and falls back to the global prefix.
  serialPrefix: prefix.nullable(),
} as const;

export const createProductSchema = z.object({
  name: fields.name,
  sku: fields.sku,
  description: fields.description.optional().default(""),
  warrantyMonths: fields.warrantyMonths.optional(), // service fills from settings
  serialPrefix: fields.serialPrefix.optional(),
});

export const updateProductSchema = z
  .object(fields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
