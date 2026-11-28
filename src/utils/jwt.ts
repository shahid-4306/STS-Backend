// import jwt, { SignOptions } from "jsonwebtoken";
// import { env } from "../config/env";

// export interface JwtPayload {
//   id: string;
//   email: string;
// }

// export function signToken(payload: JwtPayload): string {
//   const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as any };
//   return jwt.sign(payload, env.JWT_SECRET, options);
// }

// export function verifyToken(token: string): JwtPayload {
//   return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
// }

import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
  id: string;
  email: string;
  /** Unix seconds when the user actually typed their password. Kept across refreshes so one login cannot live forever. */
  authAt: number;
  iat?: number;
  exp?: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Signs a short-lived session token. It expires SESSION_IDLE_MINUTES after it
 * was issued; the only way to get a fresh one is POST /auth/refresh, which the
 * app calls only when the user is genuinely active. An idle session therefore
 * expires on the server by itself, whatever the browser does.
 */
export function signToken(
  payload: { id: string; email: string },
  authAt: number = nowSeconds(),
): string {
  const options: SignOptions = { expiresIn: env.SESSION_IDLE_MINUTES * 60 };
  return jwt.sign({ ...payload, authAt }, env.JWT_SECRET, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

/** True once a login is older than the absolute session cap. */
export function isPastMaxSession(authAt: number | undefined): boolean {
  if (!authAt) return true; // tokens from before this change carry no authAt
  return nowSeconds() - authAt > env.SESSION_MAX_HOURS * 3600;
}
