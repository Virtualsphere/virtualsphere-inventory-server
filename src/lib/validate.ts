import { z } from "zod";
import { ZodError } from "zod";
import { badRequest } from "./errors";

/**
 * Parse `data` with a Zod schema, returning the schema's OUTPUT type (so any
 * `.default()`s are applied and non-optional in the result). A validation
 * failure becomes a 400 AppError with a flattened, client-friendly issue list.
 */
export function parse<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  try {
    return schema.parse(data) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw badRequest("Validation failed", err.flatten());
    }
    throw err;
  }
}
