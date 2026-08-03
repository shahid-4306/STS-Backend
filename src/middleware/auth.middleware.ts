import { Response, NextFunction } from "express";
import { AuthRequest } from "../types";
import { verifyToken } from "../utils/jwt";
import { fail } from "../utils/apiResponse";

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return fail(res, "Not authenticated. Please log in.", 401);
  }
  const token = header.split(" ")[1];
  try {
    const payload = verifyToken(token);
    req.admin = { id: payload.id, email: payload.email };
    next();
  } catch (err) {
    return fail(res, "Session expired or invalid token. Please log in again.", 401);
  }
}
