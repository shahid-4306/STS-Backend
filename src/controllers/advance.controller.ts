import { Response } from "express";
import Advance from "../models/Advance";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const listAdvances = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.query;
  const filter: any = {};
  if (customerId) filter.customerId = customerId;
  const advances = await Advance.find(filter).populate("customerId", "fullName city phone").sort({ date: -1 });
  return ok(res, advances, "Advances fetched.");
});

export const createAdvance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, amount, date } = req.body;
  if (!customerId || !amount || Number(amount) <= 0) {
    return fail(res, "customerId and a valid amount are required.", 400);
  }
  const advance = await Advance.create({
    customerId,
    amount,
    remainingAdvance: amount,
    date: date ? new Date(date) : new Date(),
  });
  await Notification.create({
    message: `Advance of ${Number(amount).toLocaleString()} recorded for customer.`,
    type: "advance",
  });
  return created(res, advance, "Advance deposit recorded.");
});

export const customerAdvanceBalance = async (customerId: string): Promise<number> => {
  const advances = await Advance.find({ customerId }).select("remainingAdvance");
  return advances.reduce((s, a) => s + Number(a.remainingAdvance || 0), 0);
};
