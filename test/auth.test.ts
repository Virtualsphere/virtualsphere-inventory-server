/**
 * Login / registration / JWT protection, end to end over HTTP.
 *
 * DELETES all users in the target database, so — like the concurrency test —
 * it only runs when TEST_DB_NAME names a throwaway database.
 */
import "dotenv/config";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";

const TEST_DB = process.env.TEST_DB_NAME;

// Point the app at the test database BEFORE importing anything that reads the
// config: same server/user/password as the app, different database name.
if (TEST_DB) {
  process.env.DB_NAME = TEST_DB;
  delete process.env.DATABASE_URL;
}
// A fixed test secret so the suite doesn't depend on .env having one.
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-0123456789";

const ADMIN = { username: "root-admin", password: "admin-pass-123" };

describe.skipIf(!TEST_DB)("auth", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  let adminToken: string;

  async function call(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  const loginAs = async (username: string, password: string) =>
    (await call("POST", "/api/auth/login", { body: { username, password } })).body
      .token as string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations(() => {});
    ({ pool } = await import("../src/db/pool"));
    await pool.query("DELETE FROM users");

    const { registerUser } = await import("../src/modules/users/user.service");
    await registerUser({ ...ADMIN, fullName: "Root", role: "admin" });

    const { createApp } = await import("../src/app");
    server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
  });

  it("keeps health public but protects every other API route", async () => {
    expect((await call("GET", "/api/health")).status).toBe(200);
    for (const path of ["/api/products", "/api/units", "/api/stats", "/api/settings", "/api/users", "/api/auth/me"]) {
      expect((await call("GET", path)).status, path).toBe(401);
    }
    expect((await call("GET", "/api/products", { token: "garbage" })).status).toBe(401);
  });

  it("logs the admin in and returns a JWT without the password hash", async () => {
    const r = await call("POST", "/api/auth/login", { body: ADMIN });
    expect(r.status).toBe(200);
    expect(r.body.token.split(".")).toHaveLength(3);
    expect(r.body.user).toMatchObject({ username: "root-admin", role: "admin", isActive: true });
    expect(JSON.stringify(r.body)).not.toMatch(/scrypt|password/i);
    adminToken = r.body.token;

    const me = await call("GET", "/api/auth/me", { token: adminToken });
    expect(me.body.username).toBe("root-admin");
    expect(me.body.lastLoginAt).not.toBeNull();
  });

  it("rejects bad credentials with one generic message", async () => {
    const wrongPass = await call("POST", "/api/auth/login", { body: { username: "root-admin", password: "nope-nope" } });
    const noUser = await call("POST", "/api/auth/login", { body: { username: "ghost", password: "nope-nope" } });
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPass.body.error.message).toBe(noUser.body.error.message);
    // Username is case-insensitive.
    expect((await call("POST", "/api/auth/login", { body: { ...ADMIN, username: "ROOT-ADMIN" } })).status).toBe(200);
  });

  it("lets only an admin register users", async () => {
    const r = await call("POST", "/api/auth/register", {
      token: adminToken,
      body: { username: "clerk", fullName: "Shop Clerk", password: "clerk-pass-1" },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ username: "clerk", role: "user" });

    expect((await call("POST", "/api/auth/register", { body: { username: "x1", password: "whatever-123" } })).status).toBe(401);

    const clerkToken = await loginAs("clerk", "clerk-pass-1");
    const byClerk = await call("POST", "/api/auth/register", {
      token: clerkToken,
      body: { username: "x2", password: "whatever-123" },
    });
    expect(byClerk.status).toBe(403);

    const dup = await call("POST", "/api/auth/register", {
      token: adminToken,
      body: { username: "CLERK", password: "whatever-123" },
    });
    expect(dup.status).toBe(409);

    const weak = await call("POST", "/api/auth/register", {
      token: adminToken,
      body: { username: "weak", password: "short" },
    });
    expect(weak.status).toBe(400);
  });

  it("gives regular users stock access but not admin actions", async () => {
    const clerk = await loginAs("clerk", "clerk-pass-1");
    expect((await call("GET", "/api/products", { token: clerk })).status).toBe(200);
    expect((await call("GET", "/api/settings", { token: clerk })).status).toBe(200);
    expect((await call("PUT", "/api/settings", { token: clerk, body: { companyName: "X" } })).status).toBe(403);
    expect((await call("GET", "/api/users", { token: clerk })).status).toBe(403);
    expect((await call("DELETE", "/api/products/00000000-0000-4000-8000-000000000000", { token: clerk })).status).toBe(403);
  });

  it("revokes old tokens on password change and deactivation", async () => {
    const t1 = await loginAs("clerk", "clerk-pass-1");
    const changed = await call("POST", "/api/auth/change-password", {
      token: t1,
      body: { currentPassword: "clerk-pass-1", newPassword: "clerk-pass-2" },
    });
    expect(changed.status).toBe(200);
    expect((await call("GET", "/api/auth/me", { token: t1 })).status).toBe(401);
    const t2 = changed.body.token as string;
    expect((await call("GET", "/api/auth/me", { token: t2 })).status).toBe(200);

    const users = (await call("GET", "/api/users", { token: adminToken })).body as Array<{ id: string; username: string }>;
    const clerkId = users.find((u) => u.username === "clerk")!.id;
    await call("PATCH", `/api/users/${clerkId}`, { token: adminToken, body: { isActive: false } });
    expect((await call("GET", "/api/auth/me", { token: t2 })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { body: { username: "clerk", password: "clerk-pass-2" } })).status).toBe(401);
  });

  it("never lets the last admin lock themselves out", async () => {
    const me = (await call("GET", "/api/auth/me", { token: adminToken })).body;
    for (const body of [{ role: "user" }, { isActive: false }]) {
      expect((await call("PATCH", `/api/users/${me.id}`, { token: adminToken, body })).status).toBe(400);
    }
    expect((await call("DELETE", `/api/users/${me.id}`, { token: adminToken })).status).toBe(400);
  });
});
