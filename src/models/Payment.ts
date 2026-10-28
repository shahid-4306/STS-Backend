import { Schema, model } from "mongoose";
import { IPayment } from "../types";
import { generateDisplayId } from "../utils/generateId";

const PaymentSchema = new Schema<IPayment>({
  displayId: { type: String, unique: true, default: () => generateDisplayId("PAY") },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
  billId: { type: Schema.Types.ObjectId, ref: "Bill", required: true },
  receivedAmount: { type: Number, required: true, min: 0 },
  paymentDate: { type: Date, default: Date.now },
  method: { type: String, default: "Bank Transfer" },
  remarks: { type: String, default: "" },
  source: { type: String, enum: ["bill", "collection"] },
  requestId: { type: String },
});

PaymentSchema.index({ customerId: 1, paymentDate: -1 });
PaymentSchema.index({ billId: 1 });
// Sparse + unique: only payments submitted with an idempotency key are constrained.
PaymentSchema.index({ requestId: 1 }, { unique: true, sparse: true });

export default model<IPayment>("Payment", PaymentSchema);
