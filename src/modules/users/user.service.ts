import { badRequest, conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { hashPassword } from "../../lib/password";
import type { User } from "../../types";
import {
  countActiveAdmins,
  deleteUserRow,
  findUserRowById,
  insertUser,
  listUserRows,
  mapUser,
  updateUserRow,
} from "./user.repo";
import type { RegisterInput, UpdateUserInput } from "./user.schema";

export async function registerUser(input: RegisterInput): Promise<User> {
  try {
    const row = await insertUser({
      username: input.username,
      fullName: input.fullName,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    });
    return mapUser(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`Username "${input.username}" is already taken`);
    }
    throw err;
  }
}

export async function listUsers(): Promise<User[]> {
  return (await listUserRows()).map(mapUser);
}

/**
 * Admin edits another account. Guards against locking everyone out: an admin
 * cannot demote, deactivate or delete themselves, and the last active admin
 * can never be removed.
 */
export async function updateUser(
  actorId: string,
  id: string,
  patch: UpdateUserInput,
): Promise<User> {
  const existing = await findUserRowById(id);
  if (!existing) throw notFound("User");

  const self = actorId === id;
  if (self && (patch.role === "user" || patch.isActive === false)) {
    throw badRequest("You cannot demote or deactivate your own account");
  }
  const losesAdmin =
    existing.role === "admin" &&
    existing.is_active === 1 &&
    (patch.role === "user" || patch.isActive === false);
  if (losesAdmin && (await countActiveAdmins()) <= 1) {
    throw badRequest("There must be at least one active admin");
  }

  const columns: Record<string, unknown> = {};
  if (patch.fullName !== undefined) columns["full_name"] = patch.fullName;
  if (patch.role !== undefined) columns["role"] = patch.role;
  if (patch.isActive !== undefined) columns["is_active"] = patch.isActive ? 1 : 0;
  if (patch.password !== undefined) {
    columns["password_hash"] = await hashPassword(patch.password);
  }

  // Sign the user out everywhere when their access or credentials change.
  // (An admin resetting their OWN password here is fine too — the UI uses
  // /auth/change-password for that, which hands back a new token.)
  const revoke =
    patch.password !== undefined ||
    patch.isActive === false ||
    (patch.role !== undefined && patch.role !== existing.role);

  await updateUserRow(id, columns, revoke);
  return mapUser((await findUserRowById(id))!);
}

export async function deleteUser(actorId: string, id: string): Promise<void> {
  if (actorId === id) throw badRequest("You cannot delete your own account");
  const existing = await findUserRowById(id);
  if (!existing) throw notFound("User");
  if (existing.role === "admin" && existing.is_active === 1 && (await countActiveAdmins()) <= 1) {
    throw badRequest("There must be at least one active admin");
  }
  await deleteUserRow(id);
}
