import { Response } from "express";
import mongoose from "mongoose";
import Bill from "../models/Bill";
import Customer from "../models/Customer";
import Payment from "../models/Payment";
import Advance from "../models/Advance";
import Arrears from "../models/Arrears";
import Counter from "../models/Counter";
import MonthlyRecord from "../models/MonthlyRecord";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";
import { buildXlsx, XlsxSheet } from "../utils/xlsxWriter";

/*  purchases       = each bill's OWN amount (grandTotal - carried balance)
 *  payments        = payments in the month + advance deposits
 *  remaining       = opening + purchases + arrears added - payments
 *  Nothing here writes to bills, payments, advances or arrears. */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DELETED_PREFIX = "monthly-deleted:";
const MAX_MONTHS_BACK = 120;

function httpError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

interface MonthInfo {
  key: string;
  year: number;
  month: number;
}

function parseMonth(value: any): MonthInfo {
  const m = MONTH_RE.exec(String(value ?? "").trim());
  if (!m) throw httpError("month must be in YYYY-MM format.");
  return { key: `${m[1]}-${m[2]}`, year: Number(m[1]), month: Number(m[2]) };
}
function readTzOffset(value: any): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!isFinite(n) || Math.abs(n) > 14 * 60)
    throw httpError("Invalid tzOffset.");
  return n;
}
function currentMonthKey(tz: number): string {
  const local = new Date(Date.now() - tz * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthIndex = (m: MonthInfo) => m.year * 12 + (m.month - 1);
const monthKeyFromIndex = (idx: number) =>
  `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;

interface Bounds {
  billStart: Date;
  billEnd: Date;
  payStart: Date;
  payEnd: Date;
}
function boundsFor(m: MonthInfo, tz: number): Bounds {
  const s = Date.UTC(m.year, m.month - 1, 1);
  const e = Date.UTC(m.year, m.month, 1);
  return {
    billStart: new Date(s),
    billEnd: new Date(e),
    payStart: new Date(s + tz * 60_000),
    payEnd: new Date(e + tz * 60_000),
  };
}
function assertNotFuture(m: MonthInfo, tz: number) {
  if (monthIndex(m) > monthIndex(parseMonth(currentMonthKey(tz))))
    throw httpError("That month has not started yet.");
}

/** Creates any missing record so a new month appears automatically. Deleted ones are remembered. */
async function ensureMonthRecords(m: MonthInfo, tz: number): Promise<void> {
  const { billEnd, payEnd } = boundsFor(m, tz);
  const [customers, existing, deleted] = await Promise.all([
    (async () => {
      const [created, billed, paid] = await Promise.all([
        Customer.find({ createdAt: { $lt: payEnd } })
          .select("_id")
          .lean(),
        Bill.distinct("customerId", { date: { $lt: billEnd } }),
        Payment.distinct("customerId", { paymentDate: { $lt: payEnd } }),
      ]);
      const ids = new Set<string>([
        ...created.map((c: any) => String(c._id)),
        ...billed.map(String),
        ...paid.map(String),
      ]);
      return Customer.find({ _id: { $in: [...ids] } })
        .select("_id")
        .lean();
    })(),
    MonthlyRecord.find({ monthKey: m.key }).select("customerId").lean(),
    Counter.find({ _id: { $regex: `^${DELETED_PREFIX}${m.key}:` } })
      .select("_id")
      .lean(),
  ]);
  const have = new Set(existing.map((r: any) => String(r.customerId)));
  const gone = new Set(
    deleted.map((d: any) =>
      String(d._id).slice(`${DELETED_PREFIX}${m.key}:`.length),
    ),
  );
  const missing = customers
    .map((c: any) => String(c._id))
    .filter((id) => !have.has(id) && !gone.has(id));
  if (!missing.length) return;
  try {
    await MonthlyRecord.insertMany(
      missing.map((customerId) => ({ customerId, monthKey: m.key })),
      { ordered: false },
    );
  } catch (err: any) {
    if (err?.code !== 11000 && !err?.writeErrors) throw err;
  }
}

interface Figures {
  openingBalance: number;
  purchases: number;
  arrearsAdded: number;
  paymentsReceived: number;
  remainingBalance: number;
  billCount: number;
  paymentCount: number;
}
const emptyFigures = (): Figures => ({
  openingBalance: 0,
  purchases: 0,
  arrearsAdded: 0,
  paymentsReceived: 0,
  remainingBalance: 0,
  billCount: 0,
  paymentCount: 0,
});

const OWN_AMOUNT_EXPR = {
  $subtract: [
    {
      $add: [
        { $ifNull: ["$grandTotal", 0] },
        { $ifNull: ["$advanceCredit", 0] },
        { $ifNull: ["$advanceUsed", 0] },
      ],
    },
    { $ifNull: ["$previousArrears", 0] },
  ],
};

function replaceStart(node: any, start: Date): any {
  if (node === "__START__") return start;
  if (Array.isArray(node)) return node.map((n) => replaceStart(n, start));
  if (node && typeof node === "object" && !(node instanceof Date)) {
    const o: any = {};
    for (const k of Object.keys(node)) o[k] = replaceStart(node[k], start);
    return o;
  }
  return node;
}

async function computeFigures(
  customerIds: mongoose.Types.ObjectId[],
  b: Bounds,
): Promise<Map<string, Figures>> {
  const match = { customerId: { $in: customerIds } };
  const monthGroup = (dateField: string, amountExpr: any) => ({
    _id: "$customerId",
    opening: {
      $sum: { $cond: [{ $lt: [`$${dateField}`, "__START__"] }, amountExpr, 0] },
    },
    month: {
      $sum: { $cond: [{ $lt: [`$${dateField}`, "__START__"] }, 0, amountExpr] },
    },
    count: { $sum: { $cond: [{ $lt: [`$${dateField}`, "__START__"] }, 0, 1] } },
  });
  const withStart = (stage: any, start: Date) => replaceStart(stage, start);

  const [bills, payments, advances, arrears] = await Promise.all([
    Bill.aggregate([
      { $match: { ...match, date: { $lt: b.billEnd } } },
      { $project: { customerId: 1, date: 1, own: OWN_AMOUNT_EXPR } },
      { $group: withStart(monthGroup("date", "$own"), b.billStart) },
    ]),
    Payment.aggregate([
      { $match: { ...match, paymentDate: { $lt: b.payEnd } } },
      {
        $group: withStart(
          monthGroup("paymentDate", "$receivedAmount"),
          b.payStart,
        ),
      },
    ]),
    Advance.aggregate([
      { $match: { ...match, date: { $lt: b.payEnd } } },
      { $group: withStart(monthGroup("date", "$amount"), b.payStart) },
    ]),
    Arrears.aggregate([
      { $match: { ...match, date: { $lt: b.payEnd } } },
      { $group: withStart(monthGroup("date", "$amount"), b.payStart) },
    ]),
  ]);

  const out = new Map<string, Figures>();
  const get = (id: any) => {
    const k = String(id);
    if (!out.has(k)) out.set(k, emptyFigures());
    return out.get(k)!;
  };
  const opening = new Map<string, number>();
  const addOpening = (id: any, v: number) =>
    opening.set(String(id), (opening.get(String(id)) || 0) + v);

  for (const r of bills) {
    const f = get(r._id);
    f.purchases += r.month;
    f.billCount += r.count;
    addOpening(r._id, r.opening);
  }
  for (const r of payments) {
    const f = get(r._id);
    f.paymentsReceived += r.month;
    f.paymentCount += r.count;
    addOpening(r._id, -r.opening);
  }
  for (const r of advances) {
    const f = get(r._id);
    f.paymentsReceived += r.month;
    f.paymentCount += r.count;
    addOpening(r._id, -r.opening);
  }
  for (const r of arrears) {
    const f = get(r._id);
    f.arrearsAdded += r.month;
    addOpening(r._id, r.opening);
  }

  for (const id of customerIds) {
    const f = get(id);
    f.openingBalance = round2(opening.get(String(id)) || 0);
    f.purchases = round2(f.purchases);
    f.arrearsAdded = round2(f.arrearsAdded);
    f.paymentsReceived = round2(f.paymentsReceived);
    f.remainingBalance = round2(
      f.openingBalance + f.purchases + f.arrearsAdded - f.paymentsReceived,
    );
  }
  return out;
}

interface Row {
  recordId: string;
  customer: {
    _id: string;
    displayId: string;
    fullName: string;
    city: string;
    phone: string;
  };
  figures: Figures;
}

async function loadRows(m: MonthInfo, tz: number): Promise<Row[]> {
  const records = await MonthlyRecord.find({ monthKey: m.key })
    .populate("customerId", "displayId fullName city phone")
    .lean();
  const live = records.filter((r: any) => r.customerId && r.customerId._id);
  const figures = await computeFigures(
    live.map((r: any) => r.customerId._id),
    boundsFor(m, tz),
  );
  return live
    .map((r: any) => ({
      recordId: String(r._id),
      customer: {
        _id: String(r.customerId._id),
        displayId: r.customerId.displayId,
        fullName: r.customerId.fullName,
        city: r.customerId.city,
        phone: r.customerId.phone,
      },
      figures: figures.get(String(r.customerId._id)) || emptyFigures(),
    }))
    .sort((a, b) => a.customer.fullName.localeCompare(b.customer.fullName));
}

function totalsOf(rows: Row[]) {
  const t = {
    customers: rows.length,
    openingBalance: 0,
    purchases: 0,
    arrearsAdded: 0,
    paymentsReceived: 0,
    remainingBalance: 0,
  };
  for (const r of rows) {
    t.openingBalance += r.figures.openingBalance;
    t.purchases += r.figures.purchases;
    t.arrearsAdded += r.figures.arrearsAdded;
    t.paymentsReceived += r.figures.paymentsReceived;
    t.remainingBalance += r.figures.remainingBalance;
  }
  return {
    customers: t.customers,
    openingBalance: round2(t.openingBalance),
    purchases: round2(t.purchases),
    arrearsAdded: round2(t.arrearsAdded),
    paymentsReceived: round2(t.paymentsReceived),
    remainingBalance: round2(t.remainingBalance),
  };
}

interface Detail {
  purchases: {
    billId: string;
    displayId: string;
    biltiNumber: string;
    date: string;
    billAmount: number;
    billTotal: number;
  }[];
  payments: {
    id: string;
    kind: "payment" | "advance_deposit";
    date: string;
    billRef: string | null;
    method: string;
    amount: number;
    remarks: string;
  }[];
  arrears: { id: string; date: string; amount: number; remarks: string }[];
}

async function loadDetails(
  customerIds: mongoose.Types.ObjectId[],
  b: Bounds,
): Promise<Map<string, Detail>> {
  const match = { customerId: { $in: customerIds } };
  const [bills, payments, advances, arrears] = await Promise.all([
    Bill.find({ ...match, date: { $gte: b.billStart, $lt: b.billEnd } })
      .select(
        "displayId biltiNumber date customerId grandTotal previousArrears advanceCredit advanceUsed",
      )
      .sort({ date: 1, createdAt: 1 })
      .lean(),
    Payment.find({ ...match, paymentDate: { $gte: b.payStart, $lt: b.payEnd } })
      .populate("billId", "displayId")
      .sort({ paymentDate: 1, _id: 1 })
      .lean(),
    Advance.find({ ...match, date: { $gte: b.payStart, $lt: b.payEnd } })
      .sort({ date: 1 })
      .lean(),
    Arrears.find({ ...match, date: { $gte: b.payStart, $lt: b.payEnd } })
      .sort({ date: 1 })
      .lean(),
  ]);

  const out = new Map<string, Detail>();
  const get = (id: any) => {
    const k = String(id);
    if (!out.has(k)) out.set(k, { purchases: [], payments: [], arrears: [] });
    return out.get(k)!;
  };

  for (const x of bills as any[]) {
    get(x.customerId).purchases.push({
      billId: String(x._id),
      displayId: x.displayId,
      biltiNumber: x.biltiNumber || "",
      date: new Date(x.date).toISOString(),
      billAmount: round2(
        (Number(x.grandTotal) || 0) -
          (Number(x.previousArrears) || 0) +
          (Number(x.advanceCredit) || 0) +
          (Number(x.advanceUsed) || 0),
      ),
      billTotal: round2(Number(x.grandTotal) || 0),
    });
  }
  for (const x of payments as any[]) {
    get(x.customerId).payments.push({
      id: String(x._id),
      kind: "payment",
      date: new Date(x.paymentDate).toISOString(),
      billRef: x.billId?.displayId || null,
      method: x.method || "",
      amount: round2(Number(x.receivedAmount) || 0),
      remarks: x.remarks || "",
    });
  }
  for (const x of advances as any[]) {
    get(x.customerId).payments.push({
      id: String(x._id),
      kind: "advance_deposit",
      date: new Date(x.date).toISOString(),
      billRef: null,
      method: "Advance deposit",
      amount: round2(Number(x.amount) || 0),
      remarks: `Advance ${x.displayId}`,
    });
  }
  for (const x of arrears as any[]) {
    get(x.customerId).arrears.push({
      id: String(x._id),
      date: new Date(x.date).toISOString(),
      amount: round2(Number(x.amount) || 0),
      remarks: x.remarks || `Arrears ${x.displayId}`,
    });
  }
  for (const d of out.values())
    d.payments.sort(
      (a, c) => new Date(a.date).getTime() - new Date(c.date).getTime(),
    );
  return out;
}

/* ------------------------------- handlers -------------------------------- */

export const listMonths = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    let tz: number;
    try {
      tz = readTzOffset(req.query.tzOffset);
    } catch (err: any) {
      return fail(res, err.message, err.status || 400);
    }
    const cur = parseMonth(currentMonthKey(tz));
    const [firstBill, firstPayment, firstRecord] = await Promise.all([
      Bill.findOne().sort({ date: 1 }).select("date").lean(),
      Payment.findOne().sort({ paymentDate: 1 }).select("paymentDate").lean(),
      MonthlyRecord.findOne().sort({ monthKey: 1 }).select("monthKey").lean(),
    ]);
    let earliest = monthIndex(cur);
    const consider = (d?: Date | null) => {
      if (!d) return;
      const t = new Date(d);
      if (isNaN(t.getTime())) return;
      earliest = Math.min(earliest, t.getUTCFullYear() * 12 + t.getUTCMonth());
    };
    consider((firstBill as any)?.date);
    consider((firstPayment as any)?.paymentDate);
    if ((firstRecord as any)?.monthKey)
      earliest = Math.min(
        earliest,
        monthIndex(parseMonth((firstRecord as any).monthKey)),
      );
    earliest = Math.max(earliest, monthIndex(cur) - MAX_MONTHS_BACK);
    const months: { key: string }[] = [];
    for (let i = monthIndex(cur); i >= earliest; i--)
      months.push({ key: monthKeyFromIndex(i) });
    return ok(res, { currentMonth: cur.key, months }, "Months fetched.");
  },
);

export const listMonthlyRecords = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    let m: MonthInfo, tz: number;
    try {
      tz = readTzOffset(req.query.tzOffset);
      m = parseMonth(req.query.month ?? currentMonthKey(tz));
      assertNotFuture(m, tz);
    } catch (err: any) {
      return fail(res, err.message, err.status || 400);
    }
    await ensureMonthRecords(m, tz);
    const rows = await loadRows(m, tz);
    return ok(
      res,
      { month: m.key, rows, totals: totalsOf(rows) },
      "Monthly records fetched.",
    );
  },
);

export const getMonthlyRecord = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return fail(res, "Invalid record id.", 400);
    let tz: number;
    try {
      tz = readTzOffset(req.query.tzOffset);
    } catch (err: any) {
      return fail(res, err.message, err.status || 400);
    }
    const record: any = await MonthlyRecord.findById(id)
      .populate("customerId", "displayId fullName city phone")
      .lean();
    if (!record || !record.customerId)
      return fail(res, "Monthly record not found.", 404);
    const m = parseMonth(record.monthKey);
    const b = boundsFor(m, tz);
    const customerId = record.customerId._id as mongoose.Types.ObjectId;
    const [figures, details] = await Promise.all([
      computeFigures([customerId], b),
      loadDetails([customerId], b),
    ]);
    const f = figures.get(String(customerId)) || emptyFigures();
    const d = details.get(String(customerId)) || {
      purchases: [],
      payments: [],
      arrears: [],
    };
    return ok(
      res,
      {
        recordId: String(record._id),
        month: m.key,
        customer: {
          _id: String(customerId),
          displayId: record.customerId.displayId,
          fullName: record.customerId.fullName,
          city: record.customerId.city,
          phone: record.customerId.phone,
        },
        summary: f,
        purchases: d.purchases,
        payments: d.payments,
        arrears: d.arrears,
      },
      "Monthly record fetched.",
    );
  },
);

export const deleteMonthlyRecord = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return fail(res, "Invalid record id.", 400);
    const record = await MonthlyRecord.findByIdAndDelete(id);
    if (!record) return fail(res, "Monthly record not found.", 404);
    await Counter.updateOne(
      { _id: `${DELETED_PREFIX}${record.monthKey}:${record.customerId}` },
      { $setOnInsert: { seq: 1 } },
      { upsert: true },
    );
    return ok(
      res,
      { id: String(record._id), monthKey: record.monthKey },
      "Monthly record deleted.",
    );
  },
);

export const exportMonthlyRecords = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    let m: MonthInfo, tz: number;
    try {
      tz = readTzOffset(req.query.tzOffset);
      m = parseMonth(req.query.month ?? currentMonthKey(tz));
      assertNotFuture(m, tz);
    } catch (err: any) {
      return fail(res, err.message, err.status || 400);
    }
    await ensureMonthRecords(m, tz);
    const rows = await loadRows(m, tz);
    const details = await loadDetails(
      rows.map((r) => new mongoose.Types.ObjectId(r.customer._id)),
      boundsFor(m, tz),
    );

    const serialUtc = (iso: string) =>
      Math.floor(new Date(iso).getTime() / 86_400_000) + 25569;
    const serialLocal = (iso: string) =>
      Math.floor((new Date(iso).getTime() - tz * 60_000) / 86_400_000) + 25569;
    const totals = totalsOf(rows);

    const summary: XlsxSheet = {
      name: "Summary",
      columns: [
        { header: "Customer", width: 28 },
        { header: "City", width: 16 },
        { header: "Phone", width: 16 },
        { header: "Opening Balance", width: 17, type: "number" },
        { header: "Total Purchases", width: 17, type: "number" },
        { header: "Arrears Added", width: 15, type: "number" },
        { header: "Total Payments Received", width: 22, type: "number" },
        { header: "Remaining Balance", width: 18, type: "number" },
      ],
      rows: rows.map((r) => [
        r.customer.fullName,
        r.customer.city,
        r.customer.phone,
        r.figures.openingBalance,
        r.figures.purchases,
        r.figures.arrearsAdded,
        r.figures.paymentsReceived,
        r.figures.remainingBalance,
      ]),
      totalsRow: [
        "TOTAL",
        "",
        "",
        totals.openingBalance,
        totals.purchases,
        totals.arrearsAdded,
        totals.paymentsReceived,
        totals.remainingBalance,
      ],
    };

    const purchaseRows: (string | number | null)[][] = [];
    const paymentRows: (string | number | null)[][] = [];
    const arrearsRows: (string | number | null)[][] = [];
    let pTotal = 0,
      rTotal = 0,
      aTotal = 0;
    for (const r of rows) {
      const d = details.get(r.customer._id);
      if (!d) continue;
      for (const p of d.purchases) {
        purchaseRows.push([
          r.customer.fullName,
          serialUtc(p.date),
          p.displayId,
          p.biltiNumber,
          p.billAmount,
          p.billTotal,
        ]);
        pTotal += p.billAmount;
      }
      for (const p of d.payments) {
        paymentRows.push([
          r.customer.fullName,
          serialLocal(p.date),
          p.kind === "advance_deposit" ? "Advance deposit" : "Payment",
          p.billRef || "",
          p.method,
          p.amount,
          p.remarks,
        ]);
        rTotal += p.amount;
      }
      for (const a of d.arrears) {
        arrearsRows.push([
          r.customer.fullName,
          serialLocal(a.date),
          a.amount,
          a.remarks,
        ]);
        aTotal += a.amount;
      }
    }

    const sheets: XlsxSheet[] = [
      summary,
      {
        name: "Purchases",
        columns: [
          { header: "Customer", width: 28 },
          { header: "Purchase Date", width: 15, type: "date" },
          { header: "Bill No.", width: 14 },
          { header: "Bilti No.", width: 14 },
          { header: "Bill Amount", width: 15, type: "number" },
          {
            header: "Bill Total (incl. previous balance)",
            width: 30,
            type: "number",
          },
        ],
        rows: purchaseRows,
        totalsRow: ["TOTAL", "", "", "", round2(pTotal), ""],
      },
      {
        name: "Payments Received",
        columns: [
          { header: "Customer", width: 28 },
          { header: "Payment Date", width: 15, type: "date" },
          { header: "Type", width: 16 },
          { header: "Bill No.", width: 14 },
          { header: "Method", width: 16 },
          { header: "Amount Received", width: 17, type: "number" },
          { header: "Remarks", width: 32 },
        ],
        rows: paymentRows,
        totalsRow: ["TOTAL", "", "", "", "", round2(rTotal), ""],
      },
    ];
    if (arrearsRows.length) {
      sheets.push({
        name: "Arrears Added",
        columns: [
          { header: "Customer", width: 28 },
          { header: "Date", width: 15, type: "date" },
          { header: "Amount", width: 15, type: "number" },
          { header: "Remarks", width: 32 },
        ],
        rows: arrearsRows,
        totalsRow: ["TOTAL", "", round2(aTotal), ""],
      });
    }

    const file = buildXlsx(sheets);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Monthly_Customer_Report_${m.key}.xlsx"`,
    );
    res.setHeader("Content-Length", String(file.length));
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    return res.status(200).send(file);
  },
);
