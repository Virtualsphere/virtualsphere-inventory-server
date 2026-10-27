import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** Most of a resource one intake may add. */
const MAX_RESOURCE_QUANTITY = 1_000_000;
/** Most of one resource a single unit may use. */
const MAX_PER_UNIT = 10_000;
/** Most different resources one unit may use. */
const MAX_RESOURCES_PER_UNIT = 100;

const quantity = z.number().int().min(1).max(MAX_RESOURCE_QUANTITY);

// Base field definitions WITHOUT defaults, so the update schema (which is a
// partial of these) never resurrects a default and silently overwrites a field.
const fields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
} as const;

/** Create a resource, optionally with its first stock. */
export const createResourceSchema = z.object({
  name: fields.name,
  description: fields.description.optional().default(""),
  quantity: quantity.optional(),
  notes: z.string().trim().max(2000).optional().default(""),
});

export const updateResourceSchema = z
  .object(fields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

/** Add stock to a resource: just a quantity. */
export const addResourceStockSchema = z.object({
  quantity,
  intakeDate: isoDate.optional(),
  notes: z.string().trim().max(2000).optional().default(""),
});

/**
 * The resources one unit is built with: each resource at most once, with the
 * quantity ONE unit uses. Shared by intake (applied to every new unit) and by
 * editing a unit's resources.
 */
export const unitResourcesSchema = z
  .array(
    z.object({
      resourceId: z.string().uuid(),
      quantity: z.number().int().min(1).max(MAX_PER_UNIT),
    }),
  )
  .max(MAX_RESOURCES_PER_UNIT)
  .refine(
    (lines) => new Set(lines.map((l) => l.resourceId)).size === lines.length,
    { message: "The same resource is added twice — combine those lines" },
  );

export const setUnitResourcesSchema = z.object({
  resources: unitResourcesSchema,
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;
export type AddResourceStockInput = z.infer<typeof addResourceStockSchema>;
export type UnitResourcesInput = z.infer<typeof unitResourcesSchema>;
