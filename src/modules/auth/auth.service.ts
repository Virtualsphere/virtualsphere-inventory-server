import { tooManyRequests, unauthorized } from "../../lib/errors";
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from "../../lib/password";
import type { User } from "../../types";
import {
  findUserRowById,
  findUserRowByUsername,
  mapUser,
  touchLastLogin,
  updateUserRow,
  type UserRow,
} from "../users/user.repo";
import type { ChangePasswordInput, LoginInput } from "../users/user.schema";
import { signToken, verifyToken } from "./token";

export interface AuthResult {
  token: string;
  expiresAt: string;
  user: User;
}

// --- login throttle ---------------------------------------------------------
// In-memory, per (IP, username): after MAX_FAILURES failed logins within
// WINDOW_MS, further attempts are refused until the window passes. Good enough
// for a single instance; use a shared store (Redis) if you run several.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

function throttleKey(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`;
}

function checkThrottle(key: string): void {
  const now = Date.now();
  for (const [k, v] of failures) if (now - v.first > WINDOW_MS) failures.delete(k);
  const entry = failures.get(key);
  if (entry && entry.count >= MAX_FAILURES) {
    const mins = Math.ceil((entry.first + WINDOW_MS - now) / 60000);
    throw tooManyRequests(`Too many failed logins. Try again in ${mins} minute(s).`);
  }
}

function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (entry) entry.count++;
  else failures.set(key, { count: 1, first: Date.now() });
}

// --- tokens -----------------------------------------------------------------
function issue(row: UserRow): AuthResult {
  const { token, expiresAt } = signToken({
    sub: row.id,
    role: row.role,
    tv: row.token_version,
  });
  return { token, expiresAt, user: mapUser(row) };
}

export async function login(input: LoginInput, ip: string): Promise<AuthResult> {
  const key = throttleKey(ip, input.username);
  checkThrottle(key);

  const row = await findUserRowByUsername(input.username);
  // Always run a hash comparison so unknown usernames aren't faster to reject.
  const ok = await verifyPassword(input.password, row?.password_hash ?? (await DUMMY_HASH_PROMISE));

  if (!row || !ok || row.is_active !== 1) {
    recordFailure(key);
    // One message for every case: don't reveal which usernames exist.
    throw unauthorized("Invalid username or password");
  }

  failures.delete(key);
  await touchLastLogin(row.id);
  return issue((await findUserRowById(row.id))!);
}

/**
 * Resolve a bearer token to a live, active user. Re-reading the row on each
 * request means deactivation, role changes and password resets take effect
 * immediately rather than when the token expires.
 */
export async function authenticate(token: string): Promise<UserRow> {
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    throw unauthorized("Session expired or invalid — please sign in again");
  }
  const row = await findUserRowById(claims.sub);
  if (!row || row.is_active !== 1 || row.token_version !== claims.tv) {
    throw unauthorized("Session expired or invalid — please sign in again");
  }
  return row;
}

/** Change own password; returns a fresh token (old ones stop working). */
export async function changeOwnPassword(
  row: UserRow,
  input: ChangePasswordInput,
): Promise<AuthResult> {
  if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
    throw unauthorized("Current password is incorrect");
  }
  await updateUserRow(row.id, { password_hash: await hashPassword(input.newPassword) }, true);
  return issue((await findUserRowById(row.id))!);
}
