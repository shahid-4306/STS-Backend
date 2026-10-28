import { Response } from "express";
import Customer from "../models/Customer";
import Product from "../models/Product";
import Bill from "../models/Bill";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const globalSearch = asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (!q) return fail(res, "Query parameter q is required.", 400);
  const regex = new RegExp(q, "i");

  const [customers, products, bills] = await Promise.all([
    Customer.find({ $or: [{ fullName: regex }, { city: regex }, { phone: regex }] }).limit(20),
    Product.find({ description: regex }).limit(20),
    Bill.find({ $or: [{ displayId: regex }, { biltiNumber: regex }, { driverName: regex }] }).limit(20),
  ]);

  return ok(res, { customers, products, bills }, "Search results fetched.");
});
