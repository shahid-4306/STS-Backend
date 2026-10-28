import { Response } from "express";
import Bill from "../models/Bill";
import Customer from "../models/Customer";
import Payment from "../models/Payment";
import Advance from "../models/Advance";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";
import { customerOutstanding } from "./bill.controller";

function filterByPeriod<T extends { date: Date }>(rows: T[], period: string): T[] {
  const now = new Date();
  if (period === "daily") return rows.filter((r) => new Date(r.date).toDateString() === now.toDateString());
  if (period === "weekly") {
    const wk = new Date(now);
    wk.setDate(now.getDate() - 7);
    return rows.filter((r) => new Date(r.date) >= wk);
  }
  if (period === "monthly")
    return rows.filter((r) => {
      const d = new Date(r.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  if (period === "yearly") return rows.filter((r) => new Date(r.date).getFullYear() === now.getFullYear());
  return rows;
}

export const salesReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const period = String(req.query.period || "monthly");
  const bills = await Bill.find().populate("customerId", "fullName").sort({ date: -1 });
  const filtered: typeof bills = period === "all" ? bills : filterByPeriod(bills, period);
  const total = filtered.reduce((s, b) => s + Number(b.grandTotal || 0), 0);
  return ok(res, { bills: filtered, total }, "Sales report generated.");
});

export const ledgerReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.query;
  if (!customerId) return fail(res, "customerId is required.", 400);

  const [bills, payments, advances] = await Promise.all([
    Bill.find({ customerId }),
    Payment.find({ customerId }),
    Advance.find({ customerId }),
  ]);

  const rows: any[] = [];
  bills.forEach((b) => rows.push({ date: b.date, type: "Bill", ref: b.displayId, debit: b.grandTotal, credit: 0 }));
  payments.forEach((p) =>
    rows.push({ date: p.paymentDate, type: "Payment", ref: p.displayId, debit: 0, credit: p.receivedAmount })
  );
  advances.forEach((a) =>
    rows.push({ date: a.date, type: "Advance Deposit", ref: a.displayId, debit: 0, credit: a.amount })
  );
  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return ok(res, rows, "Ledger report generated.");
});

export const outstandingReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const customers = await Customer.find();
  const owing: { customer: (typeof customers)[number]; due: number }[] = [];
  for (const c of customers) {
    const due = await customerOutstanding(String(c._id));
    if (due > 0) owing.push({ customer: c, due });
  }
  owing.sort((a, b) => b.due - a.due);
  return ok(res, owing, "Outstanding report generated.");
});

export const productSalesReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const bills = await Bill.find();
  const map: Record<string, { name: string; packets: number; total: number }> = {};
  bills.forEach((b) => {
    b.items.forEach((i) => {
      const key = String(i.productId || i.productName);
      if (!map[key]) map[key] = { name: i.productName, packets: 0, total: 0 };
      map[key].packets += Number(i.packets);
      map[key].total += Number(i.total);
    });
  });
  const rows = Object.values(map).sort((a, b) => b.total - a.total);
  return ok(res, rows, "Product sales report generated.");
});

export const paymentReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const payments = await Payment.find()
    .populate("customerId", "fullName")
    .populate("billId", "displayId")
    .sort({ paymentDate: -1 });
  const total = payments.reduce((s, p) => s + Number(p.receivedAmount || 0), 0);
  return ok(res, { payments, total }, "Payment report generated.");
});

export const advanceReport = asyncHandler(async (req: AuthRequest, res: Response) => {
  const advances = await Advance.find().populate("customerId", "fullName").sort({ date: -1 });
  return ok(res, advances, "Advance report generated.");
});
