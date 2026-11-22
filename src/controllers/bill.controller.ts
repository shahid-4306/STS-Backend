


// import { Response } from "express";
// import mongoose from "mongoose";
// import Bill from "../models/Bill";
// import Customer from "../models/Customer";
// import Product from "../models/Product";
// import Payment from "../models/Payment";
// import Advance from "../models/Advance";
// import Notification from "../models/Notification";
// import { asyncHandler } from "../utils/asyncHandler";
// import { ok, created, fail } from "../utils/apiResponse";
// import { AuthRequest } from "../types";
// import {
//   customerArrearsBalance,
//   consumeArrearsForCustomer,
// } from "./arrears.controller";

// /** Marker the auto-created "paid at bill creation" Payment has always carried. */
// export const BILL_PAYMENT_REMARK = "Payment at bill creation";

// /** Filter matching the Payment rows that belong to a bill's own creation/edit payment. */
// export const billCreationPaymentFilter = {
//   $or: [{ source: "bill" }, { remarks: BILL_PAYMENT_REMARK }],
// };

// /**
//  * Sum of remainingBalance across a customer's bills, plus any manually
//  * entered arrears not yet folded into a bill — this is a customer's total
//  * arrears. Bills whose balance was already carried forward into a later
//  * bill (absorbedIntoBillId set) are skipped: that later bill's own
//  * remainingBalance already contains them, so counting both would charge the
//  * customer twice. When editing an existing bill, pass excludeBillId so the
//  * bill's own balance isn't counted against itself.
//  */
// export async function customerOutstanding(
//   customerId: string,
//   excludeBillId?: string,
// ): Promise<number> {
//   const filter: any = { customerId, absorbedIntoBillId: null };
//   if (excludeBillId) filter._id = { $ne: excludeBillId };
//   const [bills, manualArrears] = await Promise.all([
//     Bill.find(filter).select("remainingBalance"),
//     customerArrearsBalance(customerId),
//   ]);
//   const billBalance = bills.reduce(
//     (s, b) => s + Number(b.remainingBalance || 0),
//     0,
//   );
//   return billBalance + manualArrears;
// }

// /** Sum of remainingAdvance across all of a customer's advance deposits. */
// export async function customerAdvanceBalance(
//   customerId: string,
// ): Promise<number> {
//   const advances = await Advance.find({ customerId }).select(
//     "remainingAdvance",
//   );
//   return advances.reduce((s, a) => s + Number(a.remainingAdvance || 0), 0);
// }

// /**
//  * Deducts `amount` from a customer's advance deposits, oldest deposit first
//  * (FIFO), capped at what each deposit still has available. Used at bill
//  * creation/edit time to apply an "Advance Adjustment".
//  */
// async function deductAdvanceFifo(
//   customerId: string,
//   amount: number,
// ): Promise<void> {
//   if (amount <= 0) return;
//   let toDeduct = amount;
//   const advances = await Advance.find({
//     customerId,
//     remainingAdvance: { $gt: 0 },
//   }).sort({ date: 1 });
//   for (const adv of advances) {
//     if (toDeduct <= 0) break;
//     const take = Math.min(adv.remainingAdvance, toDeduct);
//     adv.remainingAdvance -= take;
//     toDeduct -= take;
//     await adv.save();
//   }
// }

// /**
//  * Refunds `amount` back into a customer's advance deposits, in the same
//  * oldest-first order it would originally have been deducted from, capped at
//  * how much each deposit had actually been used for. This is the inverse of
//  * deductAdvanceFifo, used when editing a bill to undo its previous
//  * advance-usage before recomputing it with the new figures.
//  *
//  * Note: this assumes no other bill has drawn from the same advance pool
//  * between this bill's creation and this edit. That holds for the normal
//  * "create then occasionally correct" workflow this app is built around.
//  */
// async function refundAdvanceFifo(
//   customerId: string,
//   amount: number,
// ): Promise<void> {
//   if (amount <= 0) return;
//   let toRefund = amount;
//   const advances = await Advance.find({ customerId }).sort({ date: 1 });
//   for (const adv of advances) {
//     if (toRefund <= 0) break;
//     const used = Number(adv.amount) - Number(adv.remainingAdvance);
//     if (used <= 0) continue;
//     const refund = Math.min(used, toRefund);
//     adv.remainingAdvance += refund;
//     toRefund -= refund;
//     await adv.save();
//   }
// }

// interface ResolvedItem {
//   productId: mongoose.Types.ObjectId;
//   productName: string;
//   qtyPerPacket: string;
//   type: string;
//   unitPrice: number;
//   packets: number;
//   totalQty: number;
//   total: number;
//   groupId: string;
// }

// interface ResolvedGroup {
//   groupId: string;
//   personName: string;
// }

// const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

// function httpError(message: string, status = 400): Error {
//   return Object.assign(new Error(message), { status });
// }

// /** packets x numeric qtyPerPacket; falls back to packets when qtyPerPacket isn't a plain number. */
// export function computeTotalQty(qtyPerPacket: string, packets: number): number {
//   const perPacket = parseFloat(qtyPerPacket);
//   if (!isFinite(perPacket)) return packets;
//   return Math.round(perPacket * packets * 100) / 100;
// }

// /**
//  * Validates the named person groups submitted with a bill. Every group needs
//  * a unique, safe id and a non-empty person name.
//  */
// function resolveBillGroups(groups: any): ResolvedGroup[] {
//   if (groups === undefined || groups === null) return [];
//   if (!Array.isArray(groups)) {
//     throw httpError("groups must be an array.");
//   }
//   if (groups.length > 50) {
//     throw httpError("A bill can have at most 50 named groups.");
//   }
//   const seen = new Set<string>();
//   return groups.map((g: any) => {
//     const groupId = String(g?.groupId ?? "").trim();
//     const personName = String(g?.personName ?? "").trim();
//     if (!GROUP_ID_PATTERN.test(groupId)) {
//       throw httpError("Each group needs a valid groupId.");
//     }
//     if (seen.has(groupId)) {
//       throw httpError("Duplicate groupId submitted.");
//     }
//     seen.add(groupId);
//     if (!personName) {
//       throw httpError(
//         "Please enter a person name for every group (or remove the empty group).",
//       );
//     }
//     if (personName.length > 100) {
//       throw httpError("A person name can be at most 100 characters.");
//     }
//     return { groupId, personName };
//   });
// }

// /**
//  * Validates and recomputes bill line items server-side from live product
//  * data. Never trusts client-submitted prices/totals. Throws a descriptive
//  * error (caught by the caller) if anything is invalid.
//  */
// async function resolveBillItems(
//   items: any,
//   customerId: string,
//   groupIds: Set<string>,
// ): Promise<{ resolvedItems: ResolvedItem[]; subtotal: number }> {
//   if (!Array.isArray(items) || items.length === 0) {
//     throw httpError("At least one bill item is required.");
//   }

//   const resolvedItems: ResolvedItem[] = [];
//   let subtotal = 0;

//   for (const raw of items) {
//     if (
//       !raw ||
//       !raw.productId ||
//       !mongoose.Types.ObjectId.isValid(raw.productId)
//     ) {
//       throw httpError("Each item must reference a valid productId.");
//     }
//     const groupId = raw.groupId ? String(raw.groupId).trim() : "";
//     if (groupId && !groupIds.has(groupId)) {
//       throw httpError(
//         "An item references a person group that does not exist on this bill.",
//       );
//     }
//     const product = await Product.findById(raw.productId);
//     if (!product) {
//       throw httpError(`Product not found: ${raw.productId}`, 404);
//     }
//     if (String(product.customerId) !== String(customerId)) {
//       throw httpError(
//         `Product "${product.description}" does not belong to this customer's catalogue.`,
//       );
//     }
//     const packets = Math.max(1, Math.floor(Number(raw.packets)) || 1);
//     const unitPrice = Number(product.rate);
//     const total = unitPrice * packets;
//     subtotal += total;
//     resolvedItems.push({
//       productId: product._id,
//       productName: product.description,
//       qtyPerPacket: product.qtyPerPacket,
//       type: product.type,
//       unitPrice,
//       packets,
//       totalQty: computeTotalQty(product.qtyPerPacket, packets),
//       total,
//       groupId,
//     });
//   }

//   return { resolvedItems, subtotal };
// }

// /** Reads a money-like field: must be a finite number >= 0 (blank/undefined counts as 0). */
// function readAmount(value: any, label: string): number {
//   if (value === undefined || value === null || value === "") return 0;
//   const n = Number(value);
//   if (!isFinite(n) || n < 0) {
//     throw httpError(`${label} must be a number that is zero or greater.`);
//   }
//   return n;
// }

// /**
//  * Parses the date the received amount was actually received (YYYY-MM-DD from
//  * the date picker). Blank returns null, meaning "use the current time". Stored
//  * at midday UTC so the calendar day is the same in every timezone.
//  */
// function readReceivedDate(value: any): Date | null {
//   if (value === undefined || value === null || value === "") return null;
//   const raw = String(value).trim();
//   const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
//     ? new Date(`${raw}T12:00:00.000Z`)
//     : new Date(raw);
//   if (isNaN(d.getTime())) throw httpError("A valid received date is required.");
//   return d;
// }

// /** Parses the bill date; blank falls back to `fallback`. */
// function readBillDate(value: any, fallback: Date): Date {
//   if (value === undefined || value === null || value === "") return fallback;
//   const d = new Date(value);
//   if (isNaN(d.getTime())) throw httpError("A valid bill date is required.");
//   return d;
// }

// /**
//  * Marks the customer's other still-open bills as carried forward into
//  * `newBillId`. Their balances are already inside that bill's previousArrears,
//  * so from now on only the newer bill represents what the customer owes.
//  */
// async function absorbOpenBills(
//   customerId: string,
//   newBillId: mongoose.Types.ObjectId,
// ) {
//   await Bill.updateMany(
//     {
//       customerId,
//       _id: { $ne: newBillId },
//       absorbedIntoBillId: null,
//       remainingBalance: { $ne: 0 },
//     },
//     { $set: { absorbedIntoBillId: newBillId } },
//   );
// }

// export const listBills = asyncHandler(
//   async (req: AuthRequest, res: Response) => {
//     const { customerId, status, q } = req.query;

//     if (customerId && !mongoose.Types.ObjectId.isValid(String(customerId))) {
//       return fail(res, "Invalid customerId.", 400);
//     }
//     if (status && !["paid", "partial", "due"].includes(String(status))) {
//       return fail(
//         res,
//         "Invalid status filter. Expected one of: paid, partial, due.",
//         400,
//       );
//     }

//     const filter: any = {};
//     if (customerId) filter.customerId = customerId;
//     // A bill whose balance was carried forward into a newer bill is no longer
//     // collectable on its own, so it never shows up as due/partial.
//     if (status === "due" || status === "partial") {
//       filter.absorbedIntoBillId = null;
//     }

//     let bills = await Bill.find(filter)
//       .populate("customerId", "fullName city phone")
//       .sort({ date: -1, createdAt: -1 });

//     if (status) {
//       bills = bills.filter((b) => {
//         if (status === "paid") return b.remainingBalance <= 0;
//         if (status === "due")
//           return b.receivedAmount <= 0 && b.remainingBalance > 0;
//         if (status === "partial")
//           return b.receivedAmount > 0 && b.remainingBalance > 0;
//         return true;
//       });
//     }

//     if (q) {
//       const query = String(q).toLowerCase();
//       bills = bills.filter(
//         (b) =>
//           b.displayId.toLowerCase().includes(query) ||
//           (b.biltiNumber || "").toLowerCase().includes(query) ||
//           (b.driverName || "").toLowerCase().includes(query) ||
//           (b.groups || []).some((g) =>
//             (g.personName || "").toLowerCase().includes(query),
//           ),
//       );
//     }

//     return ok(res, bills, "Bills fetched.");
//   },
// );

// export const getBill = asyncHandler(async (req: AuthRequest, res: Response) => {
//   if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
//     return fail(res, "Invalid bill id.", 400);
//   }
//   const bill = await Bill.findById(req.params.id).populate(
//     "customerId",
//     "fullName city phone",
//   );
//   if (!bill) return fail(res, "Bill not found.", 404);
//   return ok(res, bill, "Bill fetched.");
// });

// /**
//  * Creates a new bill. Mirrors the prototype's wizard "commitBill" logic:
//  *  1. Recompute each line item's total server-side from the live product rate.
//  *  2. Pull in the customer's previous arrears automatically.
//  *  3. Deduct the requested advanceUsed from the customer's advance deposits, FIFO.
//  *  4. Compute grandTotal and remainingBalance.
//  *  5. If a receivedAmount was submitted, record a Payment.
//  *  6. Raise notifications for bill creation, payment received, and outstanding balance.
//  *
//  * Optional `clientRequestId` makes the call idempotent: re-sending the same
//  * id (double-click, retry after a timeout) returns the bill that was already
//  * saved instead of creating a second one and deducting advances twice.
//  */
// export const createBill = asyncHandler(
//   async (req: AuthRequest, res: Response) => {
//     const {
//       customerId,
//       biltiNumber,
//       driverName,
//       driverPhone,
//       date,
//       items,
//       groups,
//       discount,
//       deliveryCharges,
//       rentCharges,
//       extraCharges,
//       advanceUsed: requestedAdvanceUsed,
//       receivedAmount,
//       receivedDate,
//       paymentMethod,
//       remarks,
//     } = req.body;
//     const clientRequestId =
//       typeof req.body.clientRequestId === "string" &&
//       req.body.clientRequestId.trim()
//         ? req.body.clientRequestId.trim().slice(0, 100)
//         : undefined;

//     if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
//       return fail(res, "A valid customerId is required.", 400);
//     }
//     const customer = await Customer.findById(customerId);
//     if (!customer) return fail(res, "Customer not found.", 404);

//     if (clientRequestId) {
//       const existing = await Bill.findOne({ clientRequestId }).populate(
//         "customerId",
//         "fullName city phone",
//       );
//       if (existing) {
//         return ok(res, existing, "Bill was already saved.");
//       }
//     }

//     let resolvedItems: ResolvedItem[];
//     let resolvedGroups: ResolvedGroup[];
//     let subtotal: number;
//     let discountVal: number,
//       deliveryVal: number,
//       rentVal: number,
//       extraVal: number;
//     let receivedVal: number, billDate: Date;
//     let receivedDateVal: Date | null = null;
//     try {
//       resolvedGroups = resolveBillGroups(groups);
//       ({ resolvedItems, subtotal } = await resolveBillItems(
//         items,
//         customerId,
//         new Set(resolvedGroups.map((g) => g.groupId)),
//       ));
//       discountVal = readAmount(discount, "Discount");
//       deliveryVal = readAmount(deliveryCharges, "Delivery charges");
//       rentVal = readAmount(rentCharges, "Rent charges");
//       extraVal = readAmount(extraCharges, "Extra charges");
//       receivedVal = readAmount(receivedAmount, "Received amount");
//       billDate = readBillDate(date, new Date());
//       receivedDateVal = readReceivedDate(receivedDate);
//     } catch (err: any) {
//       return fail(res, err.message || "Invalid bill.", err.status || 400);
//     }

//     const previousArrears = await customerOutstanding(customerId);
//     const availableAdvance = await customerAdvanceBalance(customerId);

//     const advanceUsed = Math.max(
//       0,
//       Math.min(Number(requestedAdvanceUsed) || 0, availableAdvance),
//     );

//     // const grandTotal =
//     //   subtotal -
//     //   discountVal +
//     //   deliveryVal +
//     //   rentVal +
//     //   extraVal +
//     //   previousArrears -
//     //   advanceUsed;
//     // const remainingBalance = grandTotal - receivedVal;
//     const grandTotal =
//       subtotal -
//       discountVal +
//       deliveryVal -
//       rentVal +
//       extraVal +
//       previousArrears -
//       advanceUsed;
//     const remainingBalance = grandTotal - receivedVal;

//     // bill.biltiNumber = biltiNumber ?? bill.biltiNumber;

//     let bill;
//     try {
//       bill = await Bill.create({
//         customerId,
//         biltiNumber: biltiNumber || "",
//         driverName: driverName || "",
//         driverPhone: driverPhone || "",
//         date: billDate,
//         items: resolvedItems,
//         groups: resolvedGroups,
//         subtotal,
//         discount: discountVal,
//         deliveryCharges: deliveryVal,
//         rentCharges: rentVal,
//         extraCharges: extraVal,
//         previousArrears,
//         advanceUsed,
//         grandTotal,
//         receivedAmount: receivedVal,
//         remainingBalance,
//         paymentMethod: paymentMethod || "Bank Transfer",
//         remarks: remarks || "",
//         ...(clientRequestId ? { clientRequestId } : {}),
//       });
//     } catch (err: any) {
//       // Two identical submissions raced: the other one won, so hand back its bill.
//       if (err?.code === 11000 && clientRequestId) {
//         const existing = await Bill.findOne({ clientRequestId }).populate(
//           "customerId",
//           "fullName city phone",
//         );
//         if (existing) return ok(res, existing, "Bill was already saved.");
//       }
//       throw err;
//     }

//     await deductAdvanceFifo(customerId, advanceUsed);
//     // The customer's manually-entered arrears and any still-open earlier
//     // bills are now baked into this bill's own remainingBalance (via
//     // previousArrears above), so mark them as absorbed here — otherwise
//     // they'd be double-counted the next time arrears are summed.
//     await consumeArrearsForCustomer(customerId);
//     await absorbOpenBills(customerId, bill._id as mongoose.Types.ObjectId);

//     if (receivedVal > 0) {
//       await Payment.create({
//         customerId,
//         billId: bill._id,
//         receivedAmount: receivedVal,
//         method: paymentMethod || "Bank Transfer",
//         remarks: BILL_PAYMENT_REMARK,
//         source: "bill",
//         paymentDate: receivedDateVal || new Date(),
//       });
//     }

//     await Notification.create({
//       message: `Bill ${bill.displayId} saved (${grandTotal.toLocaleString()})`,
//       type: "bill",
//     });
//     if (receivedVal > 0) {
//       await Notification.create({
//         message: `Payment received: ${receivedVal.toLocaleString()} for ${bill.displayId}`,
//         type: "payment",
//       });
//     }
//     if (remainingBalance > 0) {
//       await Notification.create({
//         message: `Outstanding balance of ${remainingBalance.toLocaleString()} on ${bill.displayId}`,
//         type: "outstanding",
//       });
//     }

//     const populated = await Bill.findById(bill._id).populate(
//       "customerId",
//       "fullName city phone",
//     );
//     return created(res, populated, "Bill saved successfully.");
//   },
// );

// /**
//  * Updates an existing bill. The customer a bill belongs to cannot change
//  * (its products/pricing/arrears are all tied to that customer) — only the
//  * bill's own details, items, groups and charges can be edited.
//  *
//  * Steps:
//  *  1. Validate everything first (nothing is touched if the input is bad).
//  *  2. Recompute items from live product data (same rules as create).
//  *  3. Refund this bill's previous advanceUsed back into the customer's
//  *     advance pool (undoing its original FIFO deduction).
//  *  4. previousArrears stays exactly what was carried into this bill when it
//  *     was created — editing items/charges must not change what was brought
//  *     forward (or silently drop the manual arrears it absorbed).
//  *  5. Recompute grandTotal/remainingBalance and re-deduct the (possibly new)
//  *     advanceUsed, FIFO, from the now-refunded pool.
//  *  6. Reconcile the single "at bill creation" Payment record tied to this
//  *     bill. The Received Amount shown in the edit form is the bill's TOTAL
//  *     received (creation payment + anything collected later from Arrears), so
//  *     only the part above the later collections is written to that record —
//  *     otherwise the collected amount would be counted twice.
//  */
// export const updateBill = asyncHandler(
//   async (req: AuthRequest, res: Response) => {
//     const { id } = req.params;
//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return fail(res, "Invalid bill id.", 400);
//     }

//     const bill = await Bill.findById(id);
//     if (!bill) return fail(res, "Bill not found.", 404);

//     const {
//       biltiNumber,
//       driverName,
//       driverPhone,
//       date,
//       items,
//       groups,
//       discount,
//       deliveryCharges,
//       rentCharges,
//       extraCharges,
//       advanceUsed: requestedAdvanceUsed,
//       receivedAmount,
//       receivedDate,
//       paymentMethod,
//       remarks,
//     } = req.body;

//     const customerId = String(bill.customerId);

//     let resolvedItems: ResolvedItem[];
//     let resolvedGroups: ResolvedGroup[];
//     let subtotal: number;
//     let discountVal: number,
//       deliveryVal: number,
//       rentVal: number,
//       extraVal: number;
//     let receivedVal: number, billDate: Date;
//     let receivedDateVal: Date | null = null;
//     try {
//       resolvedGroups = resolveBillGroups(groups);
//       ({ resolvedItems, subtotal } = await resolveBillItems(
//         items,
//         customerId,
//         new Set(resolvedGroups.map((g) => g.groupId)),
//       ));
//       discountVal = readAmount(discount, "Discount");
//       deliveryVal = readAmount(deliveryCharges, "Delivery charges");
//       rentVal = readAmount(rentCharges, "Rent charges");
//       extraVal = readAmount(extraCharges, "Extra charges");
//       receivedVal = readAmount(receivedAmount, "Received amount");
//       billDate = readBillDate(date, bill.date);
//       receivedDateVal = readReceivedDate(receivedDate);
//     } catch (err: any) {
//       return fail(res, err.message || "Invalid bill.", err.status || 400);
//     }

//     // Payments collected later against this bill (Arrears > Collect Payment).
//     const laterPayments = await Payment.find({
//       billId: bill._id,
//       $nor: [billCreationPaymentFilter],
//     }).select("receivedAmount");
//     const collectedLater = laterPayments.reduce(
//       (s, p) => s + Number(p.receivedAmount || 0),
//       0,
//     );
//     if (receivedVal < collectedLater) {
//       return fail(
//         res,
//         `Received Amount cannot be lower than ${collectedLater.toLocaleString()}, which has already been collected against this bill through Arrears.`,
//         400,
//       );
//     }

//     // Undo this bill's previous advance usage before recomputing anything.
//     const previousAdvanceUsed = Number(bill.advanceUsed) || 0;
//     await refundAdvanceFifo(customerId, previousAdvanceUsed);

//     try {
//       const previousArrears = Number(bill.previousArrears) || 0;
//       const availableAdvance = await customerAdvanceBalance(customerId);
//       const advanceUsed = Math.max(
//         0,
//         Math.min(Number(requestedAdvanceUsed) || 0, availableAdvance),
//       );

//       const grandTotal =
//         subtotal -
//         discountVal +
//         deliveryVal +
//         rentVal +
//         extraVal +
//         previousArrears -
//         advanceUsed;
//       const remainingBalance = grandTotal - receivedVal;

//       bill.biltiNumber = biltiNumber ?? bill.biltiNumber;
//       bill.driverName = driverName ?? bill.driverName;
//       bill.driverPhone = driverPhone ?? bill.driverPhone;
//       bill.date = billDate;
//       bill.items = resolvedItems as any;
//       bill.groups = resolvedGroups as any;
//       bill.subtotal = subtotal;
//       bill.discount = discountVal;
//       bill.deliveryCharges = deliveryVal;
//       bill.rentCharges = rentVal;
//       bill.extraCharges = extraVal;
//       bill.previousArrears = previousArrears;
//       bill.advanceUsed = advanceUsed;
//       bill.grandTotal = grandTotal;
//       bill.receivedAmount = receivedVal;
//       bill.remainingBalance = remainingBalance;
//       bill.paymentMethod = paymentMethod || bill.paymentMethod;
//       bill.remarks = remarks ?? bill.remarks;

//       await bill.save();
//       await deductAdvanceFifo(customerId, advanceUsed);
//     } catch (err) {
//       // The bill could not be saved: put the advance back exactly as it was.
//       await deductAdvanceFifo(customerId, previousAdvanceUsed);
//       throw err;
//     }

//     // Reconcile the single auto-payment tied to bill creation/edit, without
//     // touching any separately collected Arrears payments for this bill.
//     const creationAmount = receivedVal - collectedLater;
//     const autoPayment = await Payment.findOne({
//       billId: bill._id,
//       ...billCreationPaymentFilter,
//     });
//     if (creationAmount > 0) {
//       if (autoPayment) {
//         autoPayment.receivedAmount = creationAmount;
//         autoPayment.method = paymentMethod || autoPayment.method;
//         autoPayment.source = "bill";
//         if (receivedDateVal) autoPayment.paymentDate = receivedDateVal;
//         await autoPayment.save();
//       } else {
//         await Payment.create({
//           customerId,
//           billId: bill._id,
//           receivedAmount: creationAmount,
//           method: paymentMethod || "Bank Transfer",
//           remarks: BILL_PAYMENT_REMARK,
//           source: "bill",
//           paymentDate: receivedDateVal || new Date(),
//         });
//       }
//     } else if (autoPayment) {
//       await autoPayment.deleteOne();
//     }

//     await Notification.create({
//       message: `Bill ${bill.displayId} updated (${bill.grandTotal.toLocaleString()})`,
//       type: "bill",
//     });

//     const populated = await Bill.findById(bill._id).populate(
//       "customerId",
//       "fullName city phone",
//     );
//     return ok(res, populated, "Bill updated successfully.");
//   },
// );

// /**
//  * Helper endpoint used by the New Bill wizard to preview arrears/advance
//  * before submit. When editing (excludeBillId provided), the bill keeps the
//  * previousArrears it was created with, and its previously-used advance is
//  * added back into the available pool, since it would be refunded and
//  * re-applied on save.
//  */
// export const getCustomerBillingContext = asyncHandler(
//   async (req: AuthRequest, res: Response) => {
//     const { customerId } = req.params;
//     const { excludeBillId } = req.query;

//     if (!mongoose.Types.ObjectId.isValid(customerId)) {
//       return fail(res, "Invalid customerId.", 400);
//     }
//     if (
//       excludeBillId &&
//       !mongoose.Types.ObjectId.isValid(String(excludeBillId))
//     ) {
//       return fail(res, "Invalid excludeBillId.", 400);
//     }

//     let refundableAdvance = 0;
//     let editedBillArrears: number | null = null;
//     if (excludeBillId) {
//       const excludedBill = await Bill.findById(String(excludeBillId));
//       if (
//         excludedBill &&
//         String(excludedBill.customerId) === String(customerId)
//       ) {
//         refundableAdvance = Number(excludedBill.advanceUsed) || 0;
//         editedBillArrears = Number(excludedBill.previousArrears) || 0;
//       }
//     }

//     const [currentOutstanding, currentAdvance] = await Promise.all([
//       editedBillArrears !== null
//         ? Promise.resolve(editedBillArrears)
//         : customerOutstanding(customerId),
//       customerAdvanceBalance(customerId),
//     ]);

//     return ok(
//       res,
//       {
//         previousArrears: currentOutstanding,
//         availableAdvance: currentAdvance + refundableAdvance,
//       },
//       "Billing context fetched.",
//     );
//   },
// );
import { Response } from "express";
import mongoose, { ClientSession } from "mongoose";
import Bill from "../models/Bill";
import Customer from "../models/Customer";
import Product from "../models/Product";
import Payment from "../models/Payment";
import Advance from "../models/Advance";
import Arrears from "../models/Arrears";
import InvoiceImage from "../models/InvoiceImage";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";
import { deleteStoredImage } from "../utils/fileStorage";
import {
  customerArrearsBalance,
  consumeArrearsForCustomer,
} from "./arrears.controller";

/** Marker the auto-created "paid at bill creation" Payment has always carried. */
export const BILL_PAYMENT_REMARK = "Payment at bill creation";

/** Filter matching the Payment rows that belong to a bill's own creation/edit payment. */
export const billCreationPaymentFilter = {
  $or: [{ source: "bill" }, { remarks: BILL_PAYMENT_REMARK }],
};

/**
 * Sum of remainingBalance across a customer's bills, plus any manually
 * entered arrears not yet folded into a bill — this is a customer's total
 * arrears. Bills whose balance was already carried forward into a later
 * bill (absorbedIntoBillId set) are skipped: that later bill's own
 * remainingBalance already contains them, so counting both would charge the
 * customer twice. When editing an existing bill, pass excludeBillId so the
 * bill's own balance isn't counted against itself.
 */
export async function customerOutstanding(
  customerId: string,
  excludeBillId?: string,
): Promise<number> {
  const filter: any = { customerId, absorbedIntoBillId: null };
  if (excludeBillId) filter._id = { $ne: excludeBillId };
  const [bills, manualArrears] = await Promise.all([
    Bill.find(filter).select("remainingBalance"),
    customerArrearsBalance(customerId),
  ]);
  const billBalance = bills.reduce(
    (s, b) => s + Number(b.remainingBalance || 0),
    0,
  );
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
 * Splits a net balance into a positive "previous arrears" component and a
 * positive "advance credit" component. A negative net balance means the
 * customer is in credit (overpaid), which is surfaced as advanceCredit.
 */
export function splitNetBalance(net: number): {
  previousArrears: number;
  advanceCredit: number;
} {
  const n = Number(net) || 0;
  return { previousArrears: n > 0 ? n : 0, advanceCredit: n < 0 ? -n : 0 };
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
  session?: ClientSession,
): Promise<void> {
  if (amount <= 0) return;
  let toRefund = amount;
  const advances = await Advance.find({ customerId })
    .sort({ date: 1 })
    .session(session ?? null);
  for (const adv of advances) {
    if (toRefund <= 0) break;
    const used = Number(adv.amount) - Number(adv.remainingAdvance);
    if (used <= 0) continue;
    const refund = Math.min(used, toRefund);
    adv.remainingAdvance += refund;
    toRefund -= refund;
    await adv.save(session ? { session } : undefined);
  }
}

interface ResolvedItem {
  productId: mongoose.Types.ObjectId;
  productName: string;
  qtyPerPacket: string;
  type: string;
  unitPrice: number;
  packets: number;
  totalQty: number;
  total: number;
  groupId: string;
}

interface ResolvedGroup {
  groupId: string;
  personName: string;
}

const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function httpError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

/** packets x numeric qtyPerPacket; falls back to packets when qtyPerPacket isn't a plain number. */
export function computeTotalQty(qtyPerPacket: string, packets: number): number {
  const perPacket = parseFloat(qtyPerPacket);
  if (!isFinite(perPacket)) return packets;
  return Math.round(perPacket * packets * 100) / 100;
}

/**
 * Validates the named person groups submitted with a bill. Every group needs
 * a unique, safe id and a non-empty person name.
 */
function resolveBillGroups(groups: any): ResolvedGroup[] {
  if (groups === undefined || groups === null) return [];
  if (!Array.isArray(groups)) {
    throw httpError("groups must be an array.");
  }
  if (groups.length > 50) {
    throw httpError("A bill can have at most 50 named groups.");
  }
  const seen = new Set<string>();
  return groups.map((g: any) => {
    const groupId = String(g?.groupId ?? "").trim();
    const personName = String(g?.personName ?? "").trim();
    if (!GROUP_ID_PATTERN.test(groupId)) {
      throw httpError("Each group needs a valid groupId.");
    }
    if (seen.has(groupId)) {
      throw httpError("Duplicate groupId submitted.");
    }
    seen.add(groupId);
    if (!personName) {
      throw httpError(
        "Please enter a person name for every group (or remove the empty group).",
      );
    }
    if (personName.length > 100) {
      throw httpError("A person name can be at most 100 characters.");
    }
    return { groupId, personName };
  });
}

/**
 * Validates and recomputes bill line items server-side from live product
 * data. Never trusts client-submitted prices/totals. Throws a descriptive
 * error (caught by the caller) if anything is invalid.
 */
async function resolveBillItems(
  items: any,
  customerId: string,
  groupIds: Set<string>,
): Promise<{ resolvedItems: ResolvedItem[]; subtotal: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError("At least one bill item is required.");
  }

  const resolvedItems: ResolvedItem[] = [];
  let subtotal = 0;

  for (const raw of items) {
    if (
      !raw ||
      !raw.productId ||
      !mongoose.Types.ObjectId.isValid(raw.productId)
    ) {
      throw httpError("Each item must reference a valid productId.");
    }
    const groupId = raw.groupId ? String(raw.groupId).trim() : "";
    if (groupId && !groupIds.has(groupId)) {
      throw httpError(
        "An item references a person group that does not exist on this bill.",
      );
    }
    const product = await Product.findById(raw.productId);
    if (!product) {
      throw httpError(`Product not found: ${raw.productId}`, 404);
    }
    if (String(product.customerId) !== String(customerId)) {
      throw httpError(
        `Product "${product.description}" does not belong to this customer's catalogue.`,
      );
    }
    const packets = Math.max(1, Math.floor(Number(raw.packets)) || 1);
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
      totalQty: computeTotalQty(product.qtyPerPacket, packets),
      total,
      groupId,
    });
  }

  return { resolvedItems, subtotal };
}

/** Reads a money-like field: must be a finite number >= 0 (blank/undefined counts as 0). */
function readAmount(value: any, label: string): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!isFinite(n) || n < 0) {
    throw httpError(`${label} must be a number that is zero or greater.`);
  }
  return n;
}

/**
 * Parses the date the received amount was actually received (YYYY-MM-DD from
 * the date picker). Blank returns null, meaning "use the current time". Stored
 * at midday UTC so the calendar day is the same in every timezone.
 */
function readReceivedDate(value: any): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00.000Z`)
    : new Date(raw);
  if (isNaN(d.getTime())) throw httpError("A valid received date is required.");
  return d;
}

/** Parses the bill date; blank falls back to `fallback`. */
function readBillDate(value: any, fallback: Date): Date {
  if (value === undefined || value === null || value === "") return fallback;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw httpError("A valid bill date is required.");
  return d;
}

/**
 * Reads a YYYY-MM-DD date filter. `edge` = "start" gives 00:00:00.000 UTC
 * of that day, "end" gives 23:59:59.999 UTC. Throws if the value is not a
 * real calendar date.
 */
function readFilterDate(value: any, edge: "start" | "end"): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) throw httpError("Dates must be in YYYY-MM-DD format.");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const base = new Date(Date.UTC(y, mo - 1, d));
  if (
    base.getUTCFullYear() !== y ||
    base.getUTCMonth() !== mo - 1 ||
    base.getUTCDate() !== d
  )
    throw httpError("Dates must be real calendar dates.");
  return edge === "start" ? base : new Date(base.getTime() + 86400000 - 1);
}

/**
 * Marks the customer's other still-open bills as carried forward into
 * `newBillId`. Their balances are already inside that bill's previousArrears,
 * so from now on only the newer bill represents what the customer owes.
 */
async function absorbOpenBills(
  customerId: string,
  newBillId: mongoose.Types.ObjectId,
) {
  await Bill.updateMany(
    {
      customerId,
      _id: { $ne: newBillId },
      absorbedIntoBillId: null,
      remainingBalance: { $ne: 0 },
    },
    { $set: { absorbedIntoBillId: newBillId } },
  );
}

export const listBills = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { customerId, status, q, startDate, endDate } = req.query;

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
    // A bill whose balance was carried forward into a newer bill is no longer
    // collectable on its own, so it never shows up as due/partial.
    if (status === "due" || status === "partial") {
      filter.absorbedIntoBillId = null;
    }

    if (startDate || endDate) {
      try {
        const range: any = {};
        if (startDate) range.$gte = readFilterDate(startDate, "start");
        if (endDate) range.$lte = readFilterDate(endDate, "end");
        if (range.$gte && range.$lte && range.$gte > range.$lte)
          return fail(res, "Start date cannot be after end date.", 400);
        filter.date = range;
      } catch (err: any) {
        return fail(res, err.message || "Invalid date filter.", err.status || 400);
      }
    }

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
          (b.driverName || "").toLowerCase().includes(query) ||
          (b.groups || []).some((g) =>
            (g.personName || "").toLowerCase().includes(query),
          ),
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
 *
 * Optional `clientRequestId` makes the call idempotent: re-sending the same
 * id (double-click, retry after a timeout) returns the bill that was already
 * saved instead of creating a second one and deducting advances twice.
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
      groups,
      discount,
      deliveryCharges,
      rentCharges,
      extraCharges,
      advanceUsed: requestedAdvanceUsed,
      receivedAmount,
      receivedDate,
      paymentMethod,
      remarks,
    } = req.body;
    const clientRequestId =
      typeof req.body.clientRequestId === "string" &&
      req.body.clientRequestId.trim()
        ? req.body.clientRequestId.trim().slice(0, 100)
        : undefined;

    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return fail(res, "A valid customerId is required.", 400);
    }
    const customer = await Customer.findById(customerId);
    if (!customer) return fail(res, "Customer not found.", 404);

    if (clientRequestId) {
      const existing = await Bill.findOne({ clientRequestId }).populate(
        "customerId",
        "fullName city phone",
      );
      if (existing) {
        return ok(res, existing, "Bill was already saved.");
      }
    }

    let resolvedItems: ResolvedItem[];
    let resolvedGroups: ResolvedGroup[];
    let subtotal: number;
    let discountVal: number,
      deliveryVal: number,
      rentVal: number,
      extraVal: number;
    let receivedVal: number, billDate: Date;
    let receivedDateVal: Date | null = null;
    try {
      resolvedGroups = resolveBillGroups(groups);
      ({ resolvedItems, subtotal } = await resolveBillItems(
        items,
        customerId,
        new Set(resolvedGroups.map((g) => g.groupId)),
      ));
      discountVal = readAmount(discount, "Discount");
      deliveryVal = readAmount(deliveryCharges, "Delivery charges");
      rentVal = readAmount(rentCharges, "Rent charges");
      extraVal = readAmount(extraCharges, "Extra charges");
      receivedVal = readAmount(receivedAmount, "Received amount");
      billDate = readBillDate(date, new Date());
      receivedDateVal = readReceivedDate(receivedDate);
    } catch (err: any) {
      return fail(res, err.message || "Invalid bill.", err.status || 400);
    }

    const { previousArrears, advanceCredit } = splitNetBalance(
      await customerOutstanding(customerId),
    );
    const availableAdvance = await customerAdvanceBalance(customerId);

    const advanceUsed = Math.max(
      0,
      Math.min(Number(requestedAdvanceUsed) || 0, availableAdvance),
    );

    const grandTotal =
      subtotal -
      discountVal +
      deliveryVal +
      rentVal +
      extraVal +
      previousArrears -
      advanceCredit -
      advanceUsed;
    const remainingBalance = grandTotal - receivedVal;

    let bill;
    try {
      bill = await Bill.create({
        customerId,
        biltiNumber: biltiNumber || "",
        driverName: driverName || "",
        driverPhone: driverPhone || "",
        date: billDate,
        items: resolvedItems,
        groups: resolvedGroups,
        subtotal,
        discount: discountVal,
        deliveryCharges: deliveryVal,
        rentCharges: rentVal,
        extraCharges: extraVal,
        previousArrears,
        advanceCredit,
        advanceUsed,
        grandTotal,
        receivedAmount: receivedVal,
        remainingBalance,
        paymentMethod: paymentMethod || "Bank Transfer",
        remarks: remarks || "",
        ...(clientRequestId ? { clientRequestId } : {}),
      });
    } catch (err: any) {
      // Two identical submissions raced: the other one won, so hand back its bill.
      if (err?.code === 11000 && clientRequestId) {
        const existing = await Bill.findOne({ clientRequestId }).populate(
          "customerId",
          "fullName city phone",
        );
        if (existing) return ok(res, existing, "Bill was already saved.");
      }
      throw err;
    }

    await deductAdvanceFifo(customerId, advanceUsed);
    // The customer's manually-entered arrears and any still-open earlier
    // bills are now baked into this bill's own remainingBalance (via
    // previousArrears above), so mark them as absorbed here — otherwise
    // they'd be double-counted the next time arrears are summed.
    await consumeArrearsForCustomer(customerId);
    await absorbOpenBills(customerId, bill._id as mongoose.Types.ObjectId);

    if (receivedVal > 0) {
      await Payment.create({
        customerId,
        billId: bill._id,
        receivedAmount: receivedVal,
        method: paymentMethod || "Bank Transfer",
        remarks: BILL_PAYMENT_REMARK,
        source: "bill",
        paymentDate: receivedDateVal || new Date(),
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
 * bill's own details, items, groups and charges can be edited.
 *
 * Steps:
 *  1. Validate everything first (nothing is touched if the input is bad).
 *  2. Recompute items from live product data (same rules as create).
 *  3. Refund this bill's previous advanceUsed back into the customer's
 *     advance pool (undoing its original FIFO deduction).
 *  4. previousArrears stays exactly what was carried into this bill when it
 *     was created — editing items/charges must not change what was brought
 *     forward (or silently drop the manual arrears it absorbed).
 *  5. Recompute grandTotal/remainingBalance and re-deduct the (possibly new)
 *     advanceUsed, FIFO, from the now-refunded pool.
 *  6. Reconcile the single "at bill creation" Payment record tied to this
 *     bill. The Received Amount shown in the edit form is the bill's TOTAL
 *     received (creation payment + anything collected later from Arrears), so
 *     only the part above the later collections is written to that record —
 *     otherwise the collected amount would be counted twice.
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
      groups,
      discount,
      deliveryCharges,
      rentCharges,
      extraCharges,
      advanceUsed: requestedAdvanceUsed,
      receivedAmount,
      receivedDate,
      paymentMethod,
      remarks,
    } = req.body;

    const customerId = String(bill.customerId);

    let resolvedItems: ResolvedItem[];
    let resolvedGroups: ResolvedGroup[];
    let subtotal: number;
    let discountVal: number,
      deliveryVal: number,
      rentVal: number,
      extraVal: number;
    let receivedVal: number, billDate: Date;
    let receivedDateVal: Date | null = null;
    try {
      resolvedGroups = resolveBillGroups(groups);
      ({ resolvedItems, subtotal } = await resolveBillItems(
        items,
        customerId,
        new Set(resolvedGroups.map((g) => g.groupId)),
      ));
      discountVal = readAmount(discount, "Discount");
      deliveryVal = readAmount(deliveryCharges, "Delivery charges");
      rentVal = readAmount(rentCharges, "Rent charges");
      extraVal = readAmount(extraCharges, "Extra charges");
      receivedVal = readAmount(receivedAmount, "Received amount");
      billDate = readBillDate(date, bill.date);
      receivedDateVal = readReceivedDate(receivedDate);
    } catch (err: any) {
      return fail(res, err.message || "Invalid bill.", err.status || 400);
    }

    // Payments collected later against this bill (Arrears > Collect Payment).
    const laterPayments = await Payment.find({
      billId: bill._id,
      $nor: [billCreationPaymentFilter],
    }).select("receivedAmount");
    const collectedLater = laterPayments.reduce(
      (s, p) => s + Number(p.receivedAmount || 0),
      0,
    );
    if (receivedVal < collectedLater) {
      return fail(
        res,
        `Received Amount cannot be lower than ${collectedLater.toLocaleString()}, which has already been collected against this bill through Arrears.`,
        400,
      );
    }

    // Undo this bill's previous advance usage before recomputing anything.
    const previousAdvanceUsed = Number(bill.advanceUsed) || 0;
    await refundAdvanceFifo(customerId, previousAdvanceUsed);

    try {
      const previousArrears = Number(bill.previousArrears) || 0;
      const advanceCredit = Number(bill.advanceCredit) || 0;
      const availableAdvance = await customerAdvanceBalance(customerId);
      const advanceUsed = Math.max(
        0,
        Math.min(Number(requestedAdvanceUsed) || 0, availableAdvance),
      );

      const grandTotal =
        subtotal -
        discountVal +
        deliveryVal +
        rentVal +
        extraVal +
        previousArrears -
        advanceCredit -
        advanceUsed;
      const remainingBalance = grandTotal - receivedVal;

      bill.biltiNumber = biltiNumber ?? bill.biltiNumber;
      bill.driverName = driverName ?? bill.driverName;
      bill.driverPhone = driverPhone ?? bill.driverPhone;
      bill.date = billDate;
      bill.items = resolvedItems as any;
      bill.groups = resolvedGroups as any;
      bill.subtotal = subtotal;
      bill.discount = discountVal;
      bill.deliveryCharges = deliveryVal;
      bill.rentCharges = rentVal;
      bill.extraCharges = extraVal;
      bill.previousArrears = previousArrears;
      bill.advanceCredit = advanceCredit;
      bill.advanceUsed = advanceUsed;
      bill.grandTotal = grandTotal;
      bill.receivedAmount = receivedVal;
      bill.remainingBalance = remainingBalance;
      bill.paymentMethod = paymentMethod || bill.paymentMethod;
      bill.remarks = remarks ?? bill.remarks;

      await bill.save();
      await deductAdvanceFifo(customerId, advanceUsed);
    } catch (err) {
      // The bill could not be saved: put the advance back exactly as it was.
      await deductAdvanceFifo(customerId, previousAdvanceUsed);
      throw err;
    }

    // Reconcile the single auto-payment tied to bill creation/edit, without
    // touching any separately collected Arrears payments for this bill.
    const creationAmount = receivedVal - collectedLater;
    const autoPayment = await Payment.findOne({
      billId: bill._id,
      ...billCreationPaymentFilter,
    });
    if (creationAmount > 0) {
      if (autoPayment) {
        autoPayment.receivedAmount = creationAmount;
        autoPayment.method = paymentMethod || autoPayment.method;
        autoPayment.source = "bill";
        if (receivedDateVal) autoPayment.paymentDate = receivedDateVal;
        await autoPayment.save();
      } else {
        await Payment.create({
          customerId,
          billId: bill._id,
          receivedAmount: creationAmount,
          method: paymentMethod || "Bank Transfer",
          remarks: BILL_PAYMENT_REMARK,
          source: "bill",
          paymentDate: receivedDateVal || new Date(),
        });
      }
    } else if (autoPayment) {
      await autoPayment.deleteOne();
    }

    await Notification.create({
      message: `Bill ${bill.displayId} updated (${bill.grandTotal.toLocaleString()})`,
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
 * before submit. When editing (excludeBillId provided), the bill keeps the
 * previousArrears it was created with, and its previously-used advance is
 * added back into the available pool, since it would be refunded and
 * re-applied on save.
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
    let editedBillNet: number | null = null;
    if (excludeBillId) {
      const excludedBill = await Bill.findById(String(excludeBillId));
      if (
        excludedBill &&
        String(excludedBill.customerId) === String(customerId)
      ) {
        refundableAdvance = Number(excludedBill.advanceUsed) || 0;
        editedBillNet =
          (Number(excludedBill.previousArrears) || 0) -
          (Number(excludedBill.advanceCredit) || 0);
      }
    }

    const [currentNet, currentAdvance] = await Promise.all([
      editedBillNet !== null
        ? Promise.resolve(editedBillNet)
        : customerOutstanding(customerId),
      customerAdvanceBalance(customerId),
    ]);

    const { previousArrears, advanceCredit } = splitNetBalance(currentNet);

    return ok(
      res,
      {
        previousArrears,
        advanceCredit,
        availableAdvance: currentAdvance + refundableAdvance,
      },
      "Billing context fetched.",
    );
  },
);

/* ============================================================
   DELETE BILL
   ============================================================ */

function isTransactionUnsupported(err: any): boolean {
  return (
    err?.code === 20 ||
    /replica set|Transaction numbers are only allowed/i.test(
      String(err?.message || ""),
    )
  );
}

async function runAtomically<T>(
  work: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  let session: ClientSession | undefined;
  try {
    session = await mongoose.startSession();
  } catch {
    return work(undefined);
  }
  try {
    let result!: T;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (err) {
      if (isTransactionUnsupported(err)) return await work(undefined);
      throw err;
    }
  } finally {
    await session.endSession();
  }
}

export const deleteBill = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, "Invalid bill id.", 400);
    }

    let storedFiles: string[] = [];
    let summary: any;
    try {
      summary = await runAtomically(async (session) => {
        storedFiles = [];
        const opts = session ? { session } : {};
        const sess = session ?? null;

        const bill = await Bill.findById(id).session(sess);
        if (!bill) throw httpError("Bill not found.", 404);
        const customerId = String(bill.customerId);

        const carriedNet =
          (Number(bill.previousArrears) || 0) -
          (Number(bill.advanceCredit) || 0);
        const contribution = (Number(bill.remainingBalance) || 0) - carriedNet;
        let adjustedBills = 0,
          reopenedBills = 0,
          restoredArrears = 0;

        if (bill.absorbedIntoBillId) {
          // A newer bill already carries this bill's balance: take its part back out of the chain.
          const nextId = bill.absorbedIntoBillId;
          const seen = new Set<string>([String(bill._id)]);
          let cursor: mongoose.Types.ObjectId | null = nextId;
          while (cursor && !seen.has(String(cursor))) {
            seen.add(String(cursor));
            const downstream = await Bill.findById(cursor).session(sess);
            if (!downstream) break;
            if (Math.abs(contribution) > 0.000001) {
              const net =
                (Number(downstream.previousArrears) || 0) -
                (Number(downstream.advanceCredit) || 0) -
                contribution;
              const split = splitNetBalance(net);
              await Bill.updateOne(
                { _id: downstream._id },
                {
                  $set: {
                    previousArrears: split.previousArrears,
                    advanceCredit: split.advanceCredit,
                    grandTotal:
                      (Number(downstream.grandTotal) || 0) - contribution,
                    remainingBalance:
                      (Number(downstream.remainingBalance) || 0) - contribution,
                  },
                },
                opts,
              );
              adjustedBills += 1;
            }
            cursor = downstream.absorbedIntoBillId as any;
          }
          await Bill.updateMany(
            { absorbedIntoBillId: bill._id },
            { $set: { absorbedIntoBillId: nextId } },
            opts,
          );
        } else {
          // Latest open bill: give back the dues it had swallowed.
          const reopened = await Bill.find({
            customerId,
            absorbedIntoBillId: bill._id,
          })
            .select("remainingBalance")
            .session(sess);
          if (reopened.length) {
            await Bill.updateMany(
              { customerId, absorbedIntoBillId: bill._id },
              { $set: { absorbedIntoBillId: null } },
              opts,
            );
            reopenedBills = reopened.length;
          }
          const reopenedTotal = reopened.reduce(
            (s, b) => s + (Number(b.remainingBalance) || 0),
            0,
          );
          let manualToRestore = carriedNet - reopenedTotal;
          if (manualToRestore > 0.005) {
            const previousBill = await Bill.findOne({
              customerId,
              _id: { $ne: bill._id },
              createdAt: { $lte: bill.createdAt },
            })
              .sort({ createdAt: -1 })
              .select("createdAt")
              .session(sess);
            const consumed = await Arrears.find({
              customerId,
              remainingArrears: 0,
              amount: { $gt: 0 },
              createdAt: {
                $gt: previousBill?.createdAt ?? new Date(0),
                $lte: bill.createdAt,
              },
            })
              .sort({ createdAt: 1 })
              .session(sess);
            for (const entry of consumed) {
              if (manualToRestore <= 0.005) break;
              const give = Math.min(Number(entry.amount) || 0, manualToRestore);
              await Arrears.updateOne(
                { _id: entry._id },
                { $set: { remainingArrears: give } },
                opts,
              );
              manualToRestore -= give;
              restoredArrears += give;
            }
          }
        }

        const advanceUsed = Number(bill.advanceUsed) || 0;
        await refundAdvanceFifo(customerId, advanceUsed, session);

        const paymentResult = await Payment.deleteMany(
          { billId: bill._id },
          opts,
        );
        const images = await InvoiceImage.find({ billId: bill._id })
          .select("storedFileName")
          .session(sess);
        storedFiles = images.map((i) => i.storedFileName);
        if (images.length)
          await InvoiceImage.deleteMany({ billId: bill._id }, opts);

        await Bill.deleteOne({ _id: bill._id }, opts);

        return {
          deletedBillId: String(bill._id),
          displayId: bill.displayId,
          paymentsRemoved: paymentResult.deletedCount || 0,
          imagesRemoved: images.length,
          advanceRefunded: advanceUsed,
          laterBillsAdjusted: adjustedBills,
          earlierBillsReopened: reopenedBills,
          manualArrearsRestored: restoredArrears,
        };
      });
    } catch (err: any) {
      return fail(res, err.message || "Could not delete bill.", err.status || 500);
    }

    for (const name of storedFiles) deleteStoredImage(name); // disk files only after DB commit
    await Notification.create({
      message: `Bill ${summary.displayId} deleted`,
      type: "bill",
    });
    return ok(res, summary, "Bill deleted successfully.");
  },
);