import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async route handler so rejected promises reach Express's error
 * middleware instead of hanging the request. (Express 4 does not do this
 * automatically.)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
