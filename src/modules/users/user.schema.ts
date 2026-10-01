import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "username must be at least 3 characters")
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, "username may contain letters, digits, . _ -");

/** Length-based policy; 8+ chars. Upper bound keeps scrypt input sane. */
export const passwordSchema = z
  .string()
  .min(8, "password must be at least 8 characters")
  .max(128);

export const roleSchema = z.enum(["admin", "user"]);

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

/** Admin-only: create an account. */
export const registerSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().max(200).optional().default(""),
  password: passwordSchema,
  role: roleSchema.optional().default("user"),
});

/** Admin-only: change another account. At least one field. */
export const updateUserSchema = z
  .object({
    fullName: z.string().trim().max(200),
    role: roleSchema,
    isActive: z.boolean(),
    password: passwordSchema, // admin password reset
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

/** Any signed-in user: change own password. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
