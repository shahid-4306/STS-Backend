import { Response } from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment";
import Bill from "../models/Bill";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const listPayments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { q, date, customerId } = req.query;
  const filter: any = {};
  if (customerId) filter.customerId = customerId;
  if (date) {
    const start = new Date(String(date));
    start.setHours(0, 0, 0, 0);
    const end = new Date(String(date));
    end.setHours(23, 59, 59, 999);
    filter.paymentDate = { $gte: start, $lte: end };
  }

  let payments = await Payment.find(filter)
    .populate("customerId", "fullName phone city")
    .populate("billId", "displayId")
    .sort({ paymentDate: -1 });

  if (q) {
    const query = String(q).toLowerCase();
    payments = payments.filter((p: any) => {
      const cust = p.customerId as any;
      const bill = p.billId as any;
      return (
        (cust?.fullName || "").toLowerCase().includes(query) ||
        (cust?.phone || "").includes(query) ||
        (bill?.displayId || "").toLowerCase().includes(query)
      );
    });
  }

  return ok(res, payments, "Payments fetched.");
});

/**
 * Records a payment against an existing bill (used by the Arrears "Collect
 * Payment" flow). Updates the bill's receivedAmount / remainingBalance,
 * creates a Payment record, and raises a notification.
 */
export const collectPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { billId, amount, method, remarks } = req.body;
  if (!billId || !amount || Number(amount) <= 0) {
    return fail(res, "billId and a valid amount are required.", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return fail(res, "Invalid billId.", 400);
  }

  const bill = await Bill.findById(billId);
  if (!bill) return fail(res, "Bill not found.", 404);

  bill.receivedAmount = Number(bill.receivedAmount || 0) + Number(amount);
  bill.remainingBalance = Math.max(0, Number(bill.remainingBalance) - Number(amount));
  await bill.save();

  const payment = await Payment.create({
    customerId: bill.customerId,
    billId: bill._id,
    receivedAmount: amount,
    method: method || "Bank Transfer",
    remarks: remarks || "",
    paymentDate: new Date(),
  });

  await Notification.create({
    message: `Payment of ${Number(amount).toLocaleString()} collected for ${bill.displayId}`,
    type: "payment",
  });

  return created(res, { payment, bill }, "Payment recorded.");
});
