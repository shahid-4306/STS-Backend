import { Request, Response, NextFunction } from "express";
import { fail } from "../utils/apiResponse";

export function notFoundHandler(req: Request, res: Response) {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error("[error]", err);

  if (err.name === "ValidationError") {
    return fail(res, "Validation error", 422, err.errors);
  }
  if (err.code === 11000) {
    return fail(res, "Duplicate value violates a unique constraint", 409, err.keyValue);
  }
  if (err.name === "CastError") {
    return fail(res, `Invalid identifier: ${err.value}`, 400);
  }

  const status = err.status || err.statusCode || 500;
  return fail(res, err.message || "Internal server error", status);
}
