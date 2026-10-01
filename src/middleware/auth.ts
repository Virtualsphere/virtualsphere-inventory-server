import type { Request, Response, NextFunction, RequestHandler } from "express";
import { forbidden, unauthorized } from "../lib/errors";
import { authenticate } from "../modules/auth/auth.service";
import type { UserRow } from "../modules/users/user.repo";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The signed-in user, set by requireAuth. */
      user?: UserRow;
    }
  }
}

/** Require a valid `Authorization: Bearer <jwt>` header. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return next(unauthorized());
  authenticate(match[1]!.trim())
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
};

/** Require the signed-in user to be an admin. Use after requireAuth. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin") return next(forbidden("Admin access required"));
  next();
}
