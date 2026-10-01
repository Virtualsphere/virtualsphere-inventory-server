import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    serialPrefix: z
      .string()
      .trim()
      .max(16)
      .regex(/^[A-Za-z0-9]*$/, "prefix must be alphanumeric")
      .transform((s) => s.toUpperCase()),
    defaultWarrantyMonths: z.number().int().min(0).max(1200),
    lowStockThreshold: z.number().int().min(0).max(1_000_000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, {
    message: "No fields to update",
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
