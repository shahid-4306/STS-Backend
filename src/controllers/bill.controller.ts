import { Response } from "express";
import mongoose from "mongoose";
import Bill from "../models/Bill";
import Customer from "../models/Customer";
import Product from "../models/Product";
import Payment from "../models/Payment";
import Advance from "../models/Advance";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";
import { customerArrearsBalance, consumeArrearsForCustomer } from "./arrears.controller";

/**
 * Sum of remainingBalance across a customer's bills, plus any manually
 * entered arrears not yet folded into a bill — this is a customer's total
 * arrears. When editing an existing bill, pass excludeBillId so the bill's
 * own (soon-to-be-recomputed) balance isn't counted against itself.
 */
export async function customerOutstanding(
  customerId: string,
  excludeBillId?: string,
): Promise<number> {
  const filter: any = { customerId };
  if (excludeBillId) filter._id = { $ne: excludeBillId };
  const [bills, manualArrears] = await Promise.all([
    Bill.find(filter).select("remainingBalance"),
    customerArrearsBalance(customerId),
  ]);
  const billBalance = bills.reduce((s, b) => s + Number(b.remainingBalance || 0), 0);
  return billBalance + manualArrears;
}

/** Sum of remainingAdvance across all of a customer's advance deposits. */
export async function customerAdvanceBalance(
  customerId: string,
): Promise<number> {
  const advances = await Advance.find({ customerId }).select(
    "remainingAdvance",
  );
  return advances.reduce((s, a) => s + Number(a.remainingAdvance || 0), 0);
}

/**
 * Deducts `amount` from a customer's advance deposits, oldest deposit first
 * (FIFO), capped at what each deposit still has available. Used at bill
 * creation/edit time to apply an "Advance Adjustment".
 */
async function deductAdvanceFifo(
  customerId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  let toDeduct = amount;
  const advances = await Advance.find({
    customerId,
    remainingAdvance: { $gt: 0 },
  }).sort({ date: 1 });
  for (const adv of advances) {
    if (toDeduct <= 0) break;
    const take = Math.min(adv.remainingAdvance, toDeduct);
    adv.remainingAdvance -= take;
    toDeduct -= take;
    await adv.save();
  }
}

/**
 * Refunds `amount` back into a customer's advance deposits, in the same
 * oldest-first order it would originally have been deducted from, capped at
 * how much each deposit had actually been used for. This is the inverse of
 * deductAdvanceFifo, used when editing a bill to undo its previous
 * advance-usage before recomputing it with the new figures.
 *
 * Note: this assumes no other bill has drawn from the same advance pool
 * between this bill's creation and this edit. That holds for the normal
 * "create then occasionally correct" workflow this app is built around.
 */
async function refundAdvanceFifo(
  customerId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  let toRefund = amount;
  const advances = await Advance.find({ customerId }).sort({ date: 1 });
  for (const adv of advances) {
    if (toRefund <= 0) break;
    const used = Number(adv.amount) - Number(adv.remainingAdvance);
    if (used <= 0) continue;
    const refund = Math.min(used, toRefund);
    adv.remainingAdvance += refund;
    toRefund -= refund;
    await adv.save();
  }
}

interface ResolvedItem {
  productId: mongoose.Types.ObjectId;
  productName: string;
  qtyPerPacket: string;
  type: string;
  unitPrice: number;
  packets: number;
  total: number;
}

/**
 * Validates and recomputes bill line items server-side from live product
 * data. Never trusts client-submitted prices/totals. Throws a descriptive
 * error (caught by the caller) if anything is invalid.
 */
async function resolveBillItems(
  items: any,
  customerId: string,
): Promise<{ resolvedItems: ResolvedItem[]; subtotal: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("At least one bill item is required."), {
      status: 400,
    });
  }

  const resolvedItems: ResolvedItem[] = [];
  let subtotal = 0;

  for (const raw of items) {
    if (
      !raw ||
      !raw.productId ||
      !mongoose.Types.ObjectId.isValid(raw.productId)
    ) {
      throw Object.assign(
        new Error("Each item must reference a valid productId."),
        { status: 400 },
      );
    }
    const product = await Product.findById(raw.productId);
    if (!product) {
      throw Object.assign(new Error(`Product not found: ${raw.productId}`), {
        status: 404,
      });
    }
    if (String(product.customerId) !== String(customerId)) {
      throw Object.assign(
        new Error(
          `Product "${product.description}" does not belong to this customer's catalogue.`,
        ),
        { status: 400 },
      );
    }
    const packets = Math.max(1, Number(raw.packets) || 1);
    const unitPrice = Number(product.rate);
    const total = unitPrice * packets;
    subtotal += total;
    resolvedItems.push({
      productId: product._id,
      productName: product.description,
      qtyPerPacket: product.qtyPerPacket,
      type: product.type,
      unitPrice,
      packets,
      total,
    });
  }

  return { resolvedItems, subtotal };
}

export const listBills = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { customerId, status, q } = req.query;

    if (customerId && !mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(res, "Invalid customerId.", 400);
    }
    if (status && !["paid", "partial", "due"].includes(String(status))) {
      return fail(
        res,
        "Invalid status filter. Expected one of: paid, partial, due.",
        400,
      );
    }

    const filter: any = {};
    if (customerId) filter.customerId = customerId;

    let bills = await Bill.find(filter)
      .populate("customerId", "fullName city phone")
      .sort({ date: -1, createdAt: -1 });

    if (status) {
      bills = bills.filter((b) => {
        if (status === "paid") return b.remainingBalance <= 0;
        if (status === "due")
          return b.receivedAmount <= 0 && b.remainingBalance > 0;
        if (status === "partial")
          return b.receivedAmount > 0 && b.remainingBalance > 0;
        return true;
      });
    }

    if (q) {
      const query = String(q).toLowerCase();
      bills = bills.filter(
        (b) =>
          b.displayId.toLowerCase().includes(query) ||
          (b.biltiNumber || "").toLowerCase().includes(query) ||
          (b.driverName || "").toLowerCase().includes(query),
      );
    }

    return ok(res, bills, "Bills fetched.");
  },
);

export const getBill = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return fail(res, "Invalid bill id.", 400);
  }
  const bill = await Bill.findById(req.params.id).populate(
    "customerId",
    "fullName city phone",
  );
  if (!bill) return fail(res, "Bill not found.", 404);
  return ok(res, bill, "Bill fetched.");
});

/**
 * Creates a new bill. Mirrors the prototype's wizard "commitBill" logic:
 *  1. Recompute each line item's total server-side from the live product rate.
 *  2. Pull in the customer's previous arrears automatically.
 *  3. Deduct the requested advanceUsed from the customer's advance deposits, FIFO.
 *  4. Compute grandTotal and remainingBalance.
 *  5. If a receivedAmount was submitted, record a Payment.
 *  6. Raise notifications for bill creation, payment received, and outstanding balance.
 */
export const createBill = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const {
      customerId,
      biltiNumber,
      driverName,
      driverPhone,
      date,
      items,
      discount,
      deliveryCharges,
      rentCharges,
      extraCharges,
      advanceUsed: requestedAdvanceUsed,
      receivedAmount,
      paymentMethod,
      remarks,
    } = req.body;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return fail(res, "A valid customerId is required.", 400);
    }
    const customer = await Customer.findById(customerId);
    if (!customer) return fail(res, "Customer not found.", 404);

    let resolvedItems: ResolvedItem[];
    let subtotal: number;
    try {
      ({ resolvedItems, subtotal } = await resolveBillItems(items, customerId));
    } catch (err: any) {
      return fail(res, err.message || "Invalid bill items.", err.status || 400);
    }

    const previousArrears = await customerOutstanding(customerId);
    const availableAdvance = await customerAdvanceBalance(customerId);

    const discountVal = Number(discount) || 0;
    const deliveryVal = Number(deliveryCharges) || 0;
    const rentVal = Number(rentCharges) || 0;
    const extraVal = Number(extraCharges) || 0;
    const advanceUsed = Math.max(
      0,
      Math.min(Number(requestedAdvanceUsed) || 0, availableAdvance),
    );
    const receivedVal = Math.max(0, Number(receivedAmount) || 0);

    const grandTotal =
      subtotal -
      discountVal +
      deliveryVal +
      rentVal +
      extraVal +
      previousArrears -
      advanceUsed;
    const remainingBalance = grandTotal - receivedVal;

    const bill = await Bill.create({
      customerId,
      biltiNumber: biltiNumber || "",
      driverName: driverName || "",
      driverPhone: driverPhone || "",
      date: date ? new Date(date) : new Date(),
      items: resolvedItems,
      subtotal,
      discount: discountVal,
      deliveryCharges: deliveryVal,
      rentCharges: rentVal,
      extraCharges: extraVal,
      previousArrears,
      advanceUsed,
      grandTotal,
      receivedAmount: receivedVal,
      remainingBalance,
      paymentMethod: paymentMethod || "Bank Transfer",
      remarks: remarks || "",
    });

    await deductAdvanceFifo(customerId, advanceUsed);
    // The customer's manually-entered arrears are now baked into this bill's
    // own remainingBalance (via previousArrears above), so clear them here —
    // otherwise they'd be double-counted the next time arrears are summed.
    await consumeArrearsForCustomer(customerId);

    if (receivedVal > 0) {
      await Payment.create({
        customerId,
        billId: bill._id,
        receivedAmount: receivedVal,
        method: paymentMethod || "Bank Transfer",
        remarks: "Payment at bill creation",
        paymentDate: new Date(),
      });
    }

    await Notification.create({
      message: `Bill ${bill.displayId} saved (${grandTotal.toLocaleString()})`,
      type: "bill",
    });
    if (receivedVal > 0) {
      await Notification.create({
        message: `Payment received: ${receivedVal.toLocaleString()} for ${bill.displayId}`,
        type: "payment",
      });
    }
    if (remainingBalance > 0) {
      await Notification.create({
        message: `Outstanding balance of ${remainingBalance.toLocaleString()} on ${bill.displayId}`,
        type: "outstanding",
      });
    }

    const populated = await Bill.findById(bill._id).populate(
      "customerId",
      "fullName city phone",
    );
    return created(res, populated, "Bill saved successfully.");
  },
);

/**
 * Updates an existing bill. The customer a bill belongs to cannot change
 * (its products/pricing/arrears are all tied to that customer) — only the
 * bill's own details, items, and charges can be edited.
 *
 * Steps:
 *  1. Recompute items from live product data (same rules as create).
 *  2. Refund this bill's previous advanceUsed back into the customer's
 *     advance pool (undoing its original FIFO deduction).
 *  3. Recompute previous arrears, excluding this bill itself.
 *  4. Recompute grandTotal/remainingBalance and re-deduct the (possibly new)
 *     advanceUsed, FIFO, from the now-refunded pool.
 *  5. Reconcile the single "at bill creation" Payment record tied to this
 *     bill (create/update/remove it to match the new receivedAmount) without
 *     touching any separately collected Arrears payments.
 */
export const updateBill = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, "Invalid bill id.", 400);
    }

    const bill = await Bill.findById(id);
    if (!bill) return fail(res, "Bill not found.", 404);

    const {
      biltiNumber,
      driverName,
      driverPhone,
      date,
      items,
      discount,
      deliveryCharges,
      rentCharges,
      extraCharges,
      advanceUsed: requestedAdvanceUsed,
      receivedAmount,
      paymentMethod,
      remarks,
    } = req.body;

    const customerId = String(bill.customerId);

    let resolvedItems: ResolvedItem[];
    let subtotal: number;
    try {
      ({ resolvedItems, subtotal } = await resolveBillItems(items, customerId));
    } catch (err: any) {
      return fail(res, err.message || "Invalid bill items.", err.status || 400);
    }

    // Undo this bill's previous advance usage before recomputing anything.
    const previousAdvanceUsed = Number(bill.advanceUsed) || 0;
    await refundAdvanceFifo(customerId, previousAdvanceUsed);

    const previousArrears = await customerOutstanding(customerId, id);
    const availableAdvance = await customerAdvanceBalance(customerId);

    const discountVal = Number(discount) || 0;
    const deliveryVal = Number(deliveryCharges) || 0;
    const rentVal = Number(rentCharges) || 0;
    const extraVal = Number(extraCharges) || 0;
    const advanceUsed = Math.max(
      0,
      Math.min(Number(requestedAdvanceUsed) || 0, availableAdvance),
    );
    const receivedVal = Math.max(0, Number(receivedAmount) || 0);

    const grandTotal =
      subtotal -
      discountVal +
      deliveryVal +
      rentVal +
      extraVal +
      previousArrears -
      advanceUsed;
    const remainingBalance = grandTotal - receivedVal;

    bill.biltiNumber = biltiNumber ?? bill.biltiNumber;
    bill.driverName = driverName ?? bill.driverName;
    bill.driverPhone = driverPhone ?? bill.driverPhone;
    bill.date = date ? new Date(date) : bill.date;
    bill.items = resolvedItems as any;
    bill.subtotal = subtotal;
    bill.discount = discountVal;
    bill.deliveryCharges = deliveryVal;
    bill.rentCharges = rentVal;
    bill.extraCharges = extraVal;
    bill.previousArrears = previousArrears;
    bill.advanceUsed = advanceUsed;
    bill.grandTotal = grandTotal;
    bill.receivedAmount = receivedVal;
    bill.remainingBalance = remainingBalance;
    bill.paymentMethod = paymentMethod || bill.paymentMethod;
    bill.remarks = remarks ?? bill.remarks;

    await bill.save();
    await deductAdvanceFifo(customerId, advanceUsed);

    // Reconcile the single auto-payment tied to bill creation/edit, without
    // touching any separately collected Arrears payments for this bill.
    const autoPayment = await Payment.findOne({
      billId: bill._id,
      remarks: "Payment at bill creation",
    });
    if (receivedVal > 0) {
      if (autoPayment) {
        autoPayment.receivedAmount = receivedVal;
        autoPayment.method = paymentMethod || autoPayment.method;
        await autoPayment.save();
      } else {
        await Payment.create({
          customerId,
          billId: bill._id,
          receivedAmount: receivedVal,
          method: paymentMethod || "Bank Transfer",
          remarks: "Payment at bill creation",
          paymentDate: new Date(),
        });
      }
    } else if (autoPayment) {
      await autoPayment.deleteOne();
    }

    await Notification.create({
      message: `Bill ${bill.displayId} updated (${grandTotal.toLocaleString()})`,
      type: "bill",
    });

    const populated = await Bill.findById(bill._id).populate(
      "customerId",
      "fullName city phone",
    );
    return ok(res, populated, "Bill updated successfully.");
  },
);

/**
 * Helper endpoint used by the New Bill wizard to preview arrears/advance
 * before submit. When editing (excludeBillId provided), the bill's own
 * arrears are excluded and its previously-used advance is added back into
 * the available pool, since it would be refunded and re-applied on save.
 */
export const getCustomerBillingContext = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { customerId } = req.params;
    const { excludeBillId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return fail(res, "Invalid customerId.", 400);
    }
    if (
      excludeBillId &&
      !mongoose.Types.ObjectId.isValid(String(excludeBillId))
    ) {
      return fail(res, "Invalid excludeBillId.", 400);
    }

    let refundableAdvance = 0;
    if (excludeBillId) {
      const excludedBill = await Bill.findById(String(excludeBillId));
      if (
        excludedBill &&
        String(excludedBill.customerId) === String(customerId)
      ) {
        refundableAdvance = Number(excludedBill.advanceUsed) || 0;
      }
    }

    const [previousArrears, currentAdvance] = await Promise.all([
      customerOutstanding(
        customerId,
        excludeBillId ? String(excludeBillId) : undefined,
      ),
      customerAdvanceBalance(customerId),
    ]);

    return ok(
      res,
      { previousArrears, availableAdvance: currentAdvance + refundableAdvance },
      "Billing context fetched.",
    );
  },
);
