import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError, isUniqueViolation } from "../lib/errors";
import { isProd } from "../config";

interface MysqlError {
  code?: string;
  sqlMessage?: string;
}

/** Central error middleware. Must be registered last, after all routes. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "bad_request",
        message: "Validation failed",
        details: err.flatten(),
      },
    });
    return;
  }

  // MySQL duplicate-key error that wasn't translated closer to the query.
  if (isUniqueViolation(err)) {
    res.status(409).json({
      error: {
        code: "conflict",
        message: "A record with the same unique value already exists",
        details: isProd ? undefined : (err as MysqlError).sqlMessage,
      },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong",
      details:
        isProd || !(err instanceof Error) ? undefined : err.message,
    },
  });
}
