import dotenv from "dotenv";

dotenv.config();

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** How to reach MySQL: either one URL, or the individual settings. */
export type DbConnection =
  | { uri: string }
  | { host: string; port: number; user: string; password: string; database: string };

/**
 * DATABASE_URL (mysql://user:pass@host:port/db), when set, wins — handy on
 * hosts that hand you a single URL. Otherwise the separate DB_* settings are
 * used, which need no URL-encoding of special characters in the password.
 */
function dbConnection(): DbConnection {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { uri: url };
  return {
    host: process.env.DB_HOST || "localhost",
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || "stockroom",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME || "stockroom",
  };
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: int(process.env.PORT, 4000),
  db: dbConnection(),
  dbPoolMax: int(process.env.DB_POOL_MAX, 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  /**
   * Express "trust proxy" setting. Set to "loopback" when running behind
   * nginx on the same machine, so req.ip is the real client (from
   * X-Forwarded-For) instead of 127.0.0.1 — the login throttle depends on it.
   * Empty = don't trust any proxy (direct exposure).
   */
  trustProxy: process.env.TRUST_PROXY ?? "",
  /** Hard cap on how many units one intake request may create. */
  maxIntakeBatch: 5000,

  // --- Auth ---
  /** HMAC secret for signing JWTs. Required — checked at startup. */
  jwtSecret: process.env.JWT_SECRET ?? "",
  /** Token lifetime, in jsonwebtoken's format ("8h", "1d", "30m", ...). */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  /** First admin, created at startup only if no admin account exists yet. */
  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminFullName: process.env.ADMIN_FULL_NAME ?? "Administrator",
} as const;

/** Fail fast on an unusable JWT secret (call at server startup). */
export function assertAuthConfig(): void {
  if (config.jwtSecret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to a random string of at least 32 characters " +
        "(e.g. node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\")",
    );
  }
}

export const isProd = config.nodeEnv === "production";
