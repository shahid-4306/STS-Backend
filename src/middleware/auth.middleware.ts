// import { Response, NextFunction } from "express";
// import { AuthRequest } from "../types";
// import { verifyToken } from "../utils/jwt";
// import { fail } from "../utils/apiResponse";

// export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
//   const header = req.headers.authorization;
//   if (!header || !header.startsWith("Bearer ")) {
//     return fail(res, "Not authenticated. Please log in.", 401);
//   }
//   const token = header.split(" ")[1];
//   try {
//     const payload = verifyToken(token);
//     req.admin = { id: payload.id, email: payload.email };
//     next();
//   } catch (err) {
//     return fail(res, "Session expired or invalid token. Please log in again.", 401);
//   }
// }

import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import { verifyToken, isPastMaxSession } from "../utils/jwt";
import { fail } from "../utils/apiResponse";
import Admin from "../models/Admin";

/**
 * Protects an endpoint. A request is accepted only if ALL of these hold:
 *  1. it carries a Bearer token with a valid signature that has not expired
 *     (tokens last SESSION_IDLE_MINUTES, so an idle session dies on its own);
 *  2. the login is not older than SESSION_MAX_HOURS;
 *  3. the admin account still exists;
 *  4. the token was not issued before the admin's last password change.
 */
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return fail(res, "Not authenticated. Please log in.", 401);
  }
  const token = header.split(" ")[1];

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return fail(
      res,
      "Session expired or invalid token. Please log in again.",
      401,
    );
  }

  if (isPastMaxSession(payload.authAt)) {
    return fail(res, "Session expired. Please log in again.", 401);
  }

  try {
    const admin = await Admin.findById(payload.id)
      .select("tokenValidAfter")
      .lean();
    if (!admin) {
      return fail(res, "Account no longer exists. Please log in again.", 401);
    }
    const validAfter = (admin as any).tokenValidAfter as Date | undefined;
    if (
      validAfter &&
      (payload.iat || 0) < Math.floor(validAfter.getTime() / 1000)
    ) {
      return fail(res, "Session is no longer valid. Please log in again.", 401);
    }
  } catch (err) {
    return next(err);
  }

  req.admin = { id: payload.id, email: payload.email };
  next();
}
