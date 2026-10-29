import { z } from "zod";

/** Create or rename a tag category: just its name. */
export const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type CategoryInput = z.infer<typeof categorySchema>;
