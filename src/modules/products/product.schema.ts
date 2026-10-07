import { z } from "zod";

// Base field definitions WITHOUT defaults, so the update schema (which is a
// partial of these) never resurrects a default and silently overwrites a field.
const fields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
} as const;

export const createProductSchema = z.object({
  name: fields.name,
  description: fields.description.optional().default(""),
});

export const updateProductSchema = z
  .object(fields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
