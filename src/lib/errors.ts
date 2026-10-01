/** Application-level error carrying an HTTP status and a stable error code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

export const notFound = (resource: string) =>
  new AppError(404, "not_found", `${resource} not found`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);

export const forbidden = (message = "You do not have permission to do that") =>
  new AppError(403, "forbidden", message);

export const tooManyRequests = (message: string) =>
  new AppError(429, "too_many_requests", message);

/** MySQL duplicate-key error code (errno 1062). */
export const DUPLICATE_ENTRY = "ER_DUP_ENTRY";

/** True when `err` is a MySQL unique/primary-key violation. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === DUPLICATE_ENTRY;
}
