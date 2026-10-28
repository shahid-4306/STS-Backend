import { Response } from "express";

export function ok(res: Response, data: any, message = "Success", status = 200) {
  return res.status(status).json({ success: true, message, data });
}

export function created(res: Response, data: any, message = "Created") {
  return ok(res, data, message, 201);
}

export function fail(res: Response, message = "Something went wrong", status = 400, errors: any = null) {
  return res.status(status).json({ success: false, message, errors });
}
