import { Response } from "express";
import mongoose from "mongoose";
import Arrears from "../models/Arrears";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const listArrears = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.query;
  const filter: any = {};
  if (customerId) filter.customerId = customerId;
  const arrears = await Arrears.find(filter)
    .populate("customerId", "fullName city phone")
    .sort({ date: -1 });
  return ok(res, arrears, "Arrears fetched.");
});

export const getArrears = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return fail(res, "Invalid arrears id.", 400);
  }
  const entry = await Arrears.findById(req.params.id).populate("customerId", "fullName city phone");
  if (!entry) return fail(res, "Arrears entry not found.", 404);
  return ok(res, entry, "Arrears entry fetched.");
});

export const createArrears = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, amount, date, remarks } = req.body;
  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
    return fail(res, "A valid customerId is required.", 400);
  }
  if (amount === undefined || amount === null || Number(amount) <= 0) {
    return fail(res, "A valid arrears amount is required.", 400);
  }
  const entry = await Arrears.create({
    customerId,
    amount: Number(amount),
    remainingArrears: Number(amount),
    date: date ? new Date(date) : new Date(),
    remarks: remarks || "",
  });
  await Notification.create({
    message: `Arrears of ${Number(amount).toLocaleString()} recorded for customer.`,
    type: "arrears",
  });
  const populated = await entry.populate("customerId", "fullName city phone");
  return created(res, populated, "Arrears entry recorded.");
});

export const updateArrears = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return fail(res, "Invalid arrears id.", 400);
  }
  const entry = await Arrears.findById(req.params.id);
  if (!entry) return fail(res, "Arrears entry not found.", 404);

  const { amount, date, remarks } = req.body;
  if (amount !== undefined && amount !== null) {
    const newAmount = Number(amount);
    if (newAmount <= 0) return fail(res, "A valid arrears amount is required.", 400);
    // Preserve however much of the entry had already been consumed/collected.
    const consumed = Number(entry.amount) - Number(entry.remainingArrears);
    entry.amount = newAmount;
    entry.remainingArrears = Math.max(0, newAmount - consumed);
  }
  if (date !== undefined) entry.date = new Date(date);
  if (remarks !== undefined) entry.remarks = remarks;

  await entry.save();
  const populated = await entry.populate("customerId", "fullName city phone");
  return ok(res, populated, "Arrears entry updated.");
});

export const deleteArrears = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return fail(res, "Invalid arrears id.", 400);
  }
  const entry = await Arrears.findByIdAndDelete(req.params.id);
  if (!entry) return fail(res, "Arrears entry not found.", 404);
  return ok(res, null, "Arrears entry deleted.");
});

/**
 * Sum of remainingArrears across all of a customer's manually-entered
 * arrears — added into `customerOutstanding()` in bill.controller.ts so
 * this amount automatically shows up as "Previous Arrears" the moment that
 * customer is selected anywhere a bill is created or previewed.
 */
export const customerArrearsBalance = async (customerId: string): Promise<number> => {
  const entries = await Arrears.find({ customerId }).select("remainingArrears");
  return entries.reduce((s, a) => s + Number(a.remainingArrears || 0), 0);
};

/**
 * Once a customer's manually-entered arrears have been folded into a new
 * bill's `previousArrears` (and therefore into that bill's own
 * remainingBalance), zero them out here so they are never counted twice —
 * the same "consume once absorbed" pattern the Advance module uses.
 */
export const consumeArrearsForCustomer = async (customerId: string): Promise<void> => {
  await Arrears.updateMany(
    { customerId, remainingArrears: { $gt: 0 } },
    { $set: { remainingArrears: 0 } },
  );
};
