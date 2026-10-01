import dotenv from "dotenv";

dotenv.config();

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: int(process.env.PORT, 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "mysql://stockroom:stockroom@localhost:3306/stockroom",
  dbPoolMax: int(process.env.DB_POOL_MAX, 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
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
