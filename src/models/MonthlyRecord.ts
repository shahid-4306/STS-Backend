import { Schema, model } from "mongoose";
import { IMonthlyRecord } from "../types";

/** One row per customer per calendar month. All figures are calculated live
 *  from Bill/Payment/Advance/Arrears; deleting a row never touches them. */
const MonthlyRecordSchema = new Schema<IMonthlyRecord>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    monthKey: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

MonthlyRecordSchema.index({ customerId: 1, monthKey: 1 }, { unique: true });
MonthlyRecordSchema.index({ monthKey: 1 });

export default model<IMonthlyRecord>("MonthlyRecord", MonthlyRecordSchema);
