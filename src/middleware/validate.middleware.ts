import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { fail } from "../utils/apiResponse";

export function validate(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return fail(res, "Validation failed", 422, errors.array());
  }
  next();
}
