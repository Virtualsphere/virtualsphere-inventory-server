import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../../config";
import type { UserRole } from "../../types";

/** Claims we put in every access token. */
export interface TokenClaims {
  sub: string; // user id
  role: UserRole; // informational only — authorization re-reads the DB
  tv: number; // users.token_version at issue time
}

const ALGORITHM = "HS256";

export function signToken(claims: TokenClaims): {
  token: string;
  expiresAt: string;
} {
  const token = jwt.sign({ role: claims.role, tv: claims.tv }, config.jwtSecret, {
    algorithm: ALGORITHM,
    subject: claims.sub,
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
  });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verify signature + expiry. Throws on any problem. */
export function verifyToken(token: string): TokenClaims {
  // Pin the algorithm so a token can't pick its own (e.g. "none").
  const payload = jwt.verify(token, config.jwtSecret, {
    algorithms: [ALGORITHM],
  });
  if (typeof payload === "string") throw new Error("Malformed token");
  const { sub, role, tv } = payload as Partial<TokenClaims>;
  if (typeof sub !== "string" || typeof tv !== "number") {
    throw new Error("Malformed token");
  }
  return { sub, role: role === "admin" ? "admin" : "user", tv };
}
