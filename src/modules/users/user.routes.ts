import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin } from "../../middleware/auth";
import { registerSchema, updateUserSchema } from "./user.schema";
import { deleteUser, listUsers, registerUser, updateUser } from "./user.service";

/** User management. Mounted behind requireAuth; every route is admin-only. */
export const userRoutes = Router();
userRoutes.use(requireAdmin);

const idParam = z.object({ id: z.string().uuid("invalid user id") });

// GET /api/users
userRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listUsers());
  }),
);

// POST /api/users   (same as POST /api/auth/register)
userRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parse(registerSchema, req.body);
    res.status(201).json(await registerUser(input));
  }),
);

// PATCH /api/users/:id   { fullName?, role?, isActive?, password? }
userRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    const patch = parse(updateUserSchema, req.body);
    res.json(await updateUser(req.user!.id, id, patch));
  }),
);

// DELETE /api/users/:id
userRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = parse(idParam, req.params);
    await deleteUser(req.user!.id, id);
    res.status(204).end();
  }),
);
