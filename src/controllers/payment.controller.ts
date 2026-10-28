import { Response } from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment";
import Bill from "../models/Bill";
import Customer from "../models/Customer";
import Advance from "../models/Advance";
import Arrears from "../models/Arrears";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";
import { customerOutstanding, customerAdvanceBalance } from "./bill.controller";

export const listPayments = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { q, date, customerId } = req.query;
  const filter: any = {};
  if (customerId) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(res, "Invalid customerId.", 400);
    }
    filter.customerId = customerId;
  }
  if (date) {
    const start = new Date(String(date));
    if (isNaN(start.getTime())) return fail(res, "Invalid date.", 400);
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
 *
 * Safety rules:
 *  - The amount may not exceed what the bill still owes (previously the bill
 *    was silently capped while the Payment row kept the full amount, so the
 *    two disagreed).
 *  - The bill is updated with one atomic conditional $inc, so two concurrent
 *    collections can never push it past zero.
 *  - An optional `requestId` makes the call idempotent: a double-click or a
 *    retry returns the original payment instead of recording it twice.
 */
export const collectPayment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { billId, amount, method, remarks } = req.body;
  const requestId =
    typeof req.body.requestId === "string" && req.body.requestId.trim()
      ? req.body.requestId.trim().slice(0, 100)
      : undefined;
  const amountVal = Number(amount);

  if (!billId || !isFinite(amountVal) || amountVal <= 0) {
    return fail(res, "billId and a valid amount are required.", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return fail(res, "Invalid billId.", 400);
  }

  if (requestId) {
    const existing = await Payment.findOne({ requestId });
    if (existing) {
      const existingBill = await Bill.findById(existing.billId);
      return ok(res, { payment: existing, bill: existingBill }, "Payment was already recorded.");
    }
  }

  const bill = await Bill.findById(billId);
  if (!bill) return fail(res, "Bill not found.", 404);
  if (bill.absorbedIntoBillId) {
    const newer = await Bill.findById(bill.absorbedIntoBillId).select("displayId");
    return fail(
      res,
      `This bill's balance was carried forward into ${newer?.displayId || "a newer bill"}. Collect the payment against that bill instead.`,
      409,
    );
  }
  if (amountVal > Number(bill.remainingBalance)) {
    return fail(
      res,
      `Amount exceeds the ${Number(bill.remainingBalance).toLocaleString()} still due on ${bill.displayId}.`,
      400,
    );
  }

  // Claim the requestId first (unique index), so a concurrent duplicate loses here.
  let payment;
  try {
    payment = await Payment.create({
      customerId: bill.customerId,
      billId: bill._id,
      receivedAmount: amountVal,
      method: method || "Bank Transfer",
      remarks: remarks || "",
      source: "collection",
      paymentDate: new Date(),
      ...(requestId ? { requestId } : {}),
    });
  } catch (err: any) {
    if (err?.code === 11000 && requestId) {
      const existing = await Payment.findOne({ requestId });
      if (existing) {
        const existingBill = await Bill.findById(existing.billId);
        return ok(res, { payment: existing, bill: existingBill }, "Payment was already recorded.");
      }
    }
    throw err;
  }

  const updatedBill = await Bill.findOneAndUpdate(
    { _id: bill._id, remainingBalance: { $gte: amountVal } },
    { $inc: { receivedAmount: amountVal, remainingBalance: -amountVal } },
    { new: true },
  );
  if (!updatedBill) {
    // Someone else paid the bill down between our check and now — undo our record.
    await payment.deleteOne();
    return fail(res, "This bill's balance changed while saving. Please refresh and try again.", 409);
  }

  await Notification.create({
    message: `Payment of ${amountVal.toLocaleString()} collected for ${bill.displayId}`,
    type: "payment",
  });

  return created(res, { payment, bill: updatedBill }, "Payment recorded.");
});

/* -------------------------------------------------------------------------- */
/*  Customer payment history (ledger)                                         */
/* -------------------------------------------------------------------------- */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns a YYYY-MM-DD string into the first (start) or last (end) millisecond
 * of that calendar day for the caller's timezone. `tzOffsetMinutes` is the
 * value of JS `new Date().getTimezoneOffset()` from the browser (UTC minus
 * local, e.g. -300 for Pakistan), so "5 Mar" means 5 Mar where the user is.
 */
function dayBoundary(value: string, edge: "start" | "end", tzOffsetMinutes: number): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const check = new Date(utc);
  // Reject impossible dates like 2026-02-31 (JS would silently roll them over).
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  const startMs = utc + tzOffsetMinutes * 60_000;
  return new Date(edge === "start" ? startMs : startMs + 86_400_000 - 1);
}

export type LedgerEntryKind =
  | "payment"
  | "advance_deposit"
  | "advance_applied"
  | "arrears_adjustment";

export interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  date: string;
  billId: string | null;
  billRef: string | null;
  /** Payment amount received (kind=payment). */
  paymentAmount: number;
  /** Advance deposited (advance_deposit) or applied to a bill (advance_applied). */
  advanceAmount: number;
  /** Manually recorded arrears / adjustment (arrears_adjustment). */
  adjustmentAmount: number;
  method: string;
  remarks: string;
  /** Bill balance still due right after this payment (payments only). */
  remainingBalance: number | null;
}

/**
 * Full transaction history for one customer, optionally limited to a
 * Start/End date range (both inclusive). Everything comes straight from the
 * Payment, Advance, Arrears and Bill collections for that customer:
 *  - payments received (with the bill's remaining balance right after each)
 *  - advance deposits
 *  - advance applied to a bill
 *  - manually recorded arrears adjustments
 */
export const customerPaymentHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.params;
  const { startDate, endDate } = req.query;
  const tzRaw = req.query.tzOffset === undefined ? 0 : Number(req.query.tzOffset);

  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return fail(res, "Invalid customerId.", 400);
  }
  if (!isFinite(tzRaw) || Math.abs(tzRaw) > 14 * 60) {
    return fail(res, "Invalid tzOffset.", 400);
  }
  const customer = await Customer.findById(customerId).select("fullName city phone displayId");
  if (!customer) return fail(res, "Customer not found.", 404);

  let start: Date | null = null;
  let end: Date | null = null;
  if (startDate) {
    start = dayBoundary(String(startDate), "start", tzRaw);
    if (!start) return fail(res, "Start Date must be a valid date (YYYY-MM-DD).", 400);
  }
  if (endDate) {
    end = dayBoundary(String(endDate), "end", tzRaw);
    if (!end) return fail(res, "End Date must be a valid date (YYYY-MM-DD).", 400);
  }
  if (start && end && start.getTime() > end.getTime()) {
    return fail(res, "Start Date cannot be after End Date.", 400);
  }

  const inRange = (field: string) => {
    if (!start && !end) return {};
    const range: any = {};
    if (start) range.$gte = start;
    if (end) range.$lte = end;
    return { [field]: range };
  };

  const [bills, payments, advances, arrears] = await Promise.all([
    Bill.find({ customerId }).select("displayId date grandTotal advanceUsed createdAt").lean(),
    // All payments are needed (not just the filtered ones) so each payment's
    // running "remaining balance" is correct even when the range cuts the bill's history.
    Payment.find({ customerId }).sort({ paymentDate: 1, _id: 1 }).lean(),
    Advance.find({ customerId, ...inRange("date") }).lean(),
    Arrears.find({ customerId, ...inRange("date") }).lean(),
  ]);

  const billById = new Map(bills.map((b: any) => [String(b._id), b]));
  const paidSoFar = new Map<string, number>();
  const entries: LedgerEntry[] = [];

  for (const p of payments as any[]) {
    const key = String(p.billId);
    const running = (paidSoFar.get(key) || 0) + Number(p.receivedAmount || 0);
    paidSoFar.set(key, running);

    const when = new Date(p.paymentDate);
    if (start && when < start) continue;
    if (end && when > end) continue;

    const bill: any = billById.get(key);
    entries.push({
      id: String(p._id),
      kind: "payment",
      date: when.toISOString(),
      billId: key,
      billRef: bill?.displayId || null,
      paymentAmount: Number(p.receivedAmount || 0),
      advanceAmount: 0,
      adjustmentAmount: 0,
      method: p.method || "",
      remarks: p.remarks || "",
      remainingBalance: bill ? Number(bill.grandTotal || 0) - running : null,
    });
  }

  for (const a of advances as any[]) {
    entries.push({
      id: String(a._id),
      kind: "advance_deposit",
      date: new Date(a.date).toISOString(),
      billId: null,
      billRef: null,
      paymentAmount: 0,
      advanceAmount: Number(a.amount || 0),
      adjustmentAmount: 0,
      method: "",
      remarks: `Advance ${a.displayId}`,
      remainingBalance: null,
    });
  }

  for (const a of arrears as any[]) {
    entries.push({
      id: String(a._id),
      kind: "arrears_adjustment",
      date: new Date(a.date).toISOString(),
      billId: null,
      billRef: null,
      paymentAmount: 0,
      advanceAmount: 0,
      adjustmentAmount: Number(a.amount || 0),
      method: "",
      remarks: a.remarks || `Arrears ${a.displayId}`,
      remainingBalance: null,
    });
  }

  for (const b of bills as any[]) {
    if (!(Number(b.advanceUsed) > 0)) continue;
    const when = new Date(b.date);
    if (start && when < start) continue;
    if (end && when > end) continue;
    entries.push({
      id: `adv-${String(b._id)}`,
      kind: "advance_applied",
      date: when.toISOString(),
      billId: String(b._id),
      billRef: b.displayId,
      paymentAmount: 0,
      advanceAmount: Number(b.advanceUsed),
      adjustmentAmount: 0,
      method: "",
      remarks: "Advance applied to bill",
      remainingBalance: null,
    });
  }

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const [outstanding, advanceBalance] = await Promise.all([
    customerOutstanding(customerId),
    customerAdvanceBalance(customerId),
  ]);

  const totals = entries.reduce(
    (t, e) => ({
      payments: t.payments + e.paymentAmount,
      advancesDeposited: t.advancesDeposited + (e.kind === "advance_deposit" ? e.advanceAmount : 0),
      advancesApplied: t.advancesApplied + (e.kind === "advance_applied" ? e.advanceAmount : 0),
      adjustments: t.adjustments + e.adjustmentAmount,
    }),
    { payments: 0, advancesDeposited: 0, advancesApplied: 0, adjustments: 0 },
  );

  return ok(
    res,
    {
      customer,
      range: { startDate: startDate ? String(startDate) : null, endDate: endDate ? String(endDate) : null },
      summary: { ...totals, currentOutstanding: outstanding, currentAdvanceBalance: advanceBalance },
      entries,
    },
    "Customer payment history fetched.",
  );
});
