import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../db/pool";
import type { User, UserRole } from "../../types";

export interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  full_name: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  token_version: number;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Strip secrets and map to the API shape. */
export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active === 1,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface NewUser {
  username: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
}

export async function insertUser(data: NewUser): Promise<UserRow> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, username, full_name, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.username, data.fullName, data.passwordHash, data.role],
  );
  return (await findUserRowById(id))!;
}

export async function findUserRowById(id: string): Promise<UserRow | null> {
  const [rows] = await pool.query<UserRow[]>("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0] ?? null;
}

/** Case-insensitive via the column collation. */
export async function findUserRowByUsername(
  username: string,
): Promise<UserRow | null> {
  const [rows] = await pool.query<UserRow[]>(
    "SELECT * FROM users WHERE username = ?",
    [username],
  );
  return rows[0] ?? null;
}

export async function listUserRows(): Promise<UserRow[]> {
  const [rows] = await pool.query<UserRow[]>(
    "SELECT * FROM users ORDER BY role ASC, username ASC",
  );
  return rows;
}

export async function countActiveAdmins(): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1",
  );
  return Number(rows[0]?.["n"] ?? 0);
}

/**
 * Patch columns on a user. `bumpTokenVersion` invalidates every JWT issued to
 * this user so far (used on password change, deactivation, role change).
 */
export async function updateUserRow(
  id: string,
  columns: Record<string, unknown>,
  bumpTokenVersion = false,
): Promise<boolean> {
  const keys = Object.keys(columns);
  const sets = keys.map((k) => `${k} = ?`);
  if (bumpTokenVersion) sets.push("token_version = token_version + 1");
  sets.push("updated_at = NOW(3)");
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
    [...keys.map((k) => columns[k]), id],
  );
  return res.affectedRows > 0;
}

export async function touchLastLogin(id: string): Promise<void> {
  await pool.query("UPDATE users SET last_login_at = NOW(3) WHERE id = ?", [id]);
}

export async function deleteUserRow(id: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM users WHERE id = ?", [id]);
  return res.affectedRows > 0;
}
