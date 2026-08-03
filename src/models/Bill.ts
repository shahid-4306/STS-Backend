// import { Schema, model } from "mongoose";
// import { IBill } from "../types";
// import { generateSequentialId } from "../utils/generateId";

// const BillItemSchema = new Schema(
//   {
//     productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
//     productName: { type: String, default: "" },
//     qtyPerPacket: { type: String, default: "" },
//     type: { type: String, default: "" },
//     unitPrice: { type: Number, default: 0 },
//     packets: { type: Number, default: 0 },
//     total: { type: Number, default: 0 },
//   },
//   { _id: false },
// );

// const BillSchema = new Schema<IBill>(
//   {
//     displayId: {
//       type: String,
//       unique: true,
//       // Sequential "BILL-000001" style invoice numbers, generated from a
//       // centralized atomic counter (see utils/generateId.ts) instead of the
//       // old random "BILL-CORRGBE2I" style IDs — guarantees uniqueness while
//       // staying readable and predictable.
//       default: () => generateSequentialId("bill", "BILL", 6),
//     },
//     customerId: {
//       type: Schema.Types.ObjectId,
//       ref: "Customer",
//       required: true,
//     },
//     biltiNumber: { type: String, default: "" },
//     driverName: { type: String, default: "" },
//     driverPhone: { type: String, default: "" },
//     date: { type: Date, required: true },
//     items: { type: [BillItemSchema], default: [] },
//     subtotal: { type: Number, default: 0 },
//     discount: { type: Number, default: 0 },
//     deliveryCharges: { type: Number, default: 0 },
//     rentCharges: { type: Number, default: 0 },
//     extraCharges: { type: Number, default: 0 },
//     previousArrears: { type: Number, default: 0 },
//     advanceUsed: { type: Number, default: 0 },
//     grandTotal: { type: Number, default: 0 },
//     receivedAmount: { type: Number, default: 0 },
//     remainingBalance: { type: Number, default: 0 },
//     paymentMethod: { type: String, default: "Bank Transfer" },
//     remarks: { type: String, default: "" },
//   },
//   { timestamps: { createdAt: true, updatedAt: false } },
// );

// BillSchema.index({ biltiNumber: "text", driverName: "text" });

// export default model<IBill>("Bill", BillSchema);

import { Schema, model } from "mongoose";
import { IBill } from "../types";
import { generateSequentialId } from "../utils/generateId";

const BillItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    productName: { type: String, default: "" },
    qtyPerPacket: { type: String, default: "" },
    type: { type: String, default: "" },
    unitPrice: { type: Number, default: 0 },
    packets: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false },
);

const BillSchema = new Schema<IBill>(
  {
    displayId: {
      type: String,
      unique: true,
      // Populated in the pre-save hook below via a centralized atomic
      // counter (see utils/generateId.ts). Kept out of `default` because
      // Mongoose's schema typings don't support async default functions.
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    biltiNumber: { type: String, default: "" },
    driverName: { type: String, default: "" },
    driverPhone: { type: String, default: "" },
    date: { type: Date, required: true },
    items: { type: [BillItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    deliveryCharges: { type: Number, default: 0 },
    rentCharges: { type: Number, default: 0 },
    extraCharges: { type: Number, default: 0 },
    previousArrears: { type: Number, default: 0 },
    advanceUsed: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    receivedAmount: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    paymentMethod: { type: String, default: "Bank Transfer" },
    remarks: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

BillSchema.pre("save", async function (next) {
  if (!this.displayId) {
    this.displayId = await generateSequentialId("bill", "BILL", 6);
  }
  next();
});

BillSchema.index({ biltiNumber: "text", driverName: "text" });

export default model<IBill>("Bill", BillSchema);
