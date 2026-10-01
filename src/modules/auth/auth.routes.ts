import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { parse } from "../../lib/validate";
import { requireAdmin, requireAuth } from "../../middleware/auth";
import { mapUser } from "../users/user.repo";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from "../users/user.schema";
import { registerUser } from "../users/user.service";
import { changeOwnPassword, login } from "./auth.service";

export const authRoutes = Router();

// POST /api/auth/login   (public) -> { token, expiresAt, user }
authRoutes.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = parse(loginSchema, req.body);
    res.json(await login(input, req.ip ?? "unknown"));
  }),
);

// GET /api/auth/me   -> the signed-in user
authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(mapUser(req.user!));
  }),
);

// POST /api/auth/change-password   -> { token, expiresAt, user } (old tokens revoked)
authRoutes.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    res.json(await changeOwnPassword(req.user!, input));
  }),
);

// POST /api/auth/register   (admin only — there is no public sign-up)
authRoutes.post(
  "/register",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parse(registerSchema, req.body);
    res.status(201).json(await registerUser(input));
  }),
);
