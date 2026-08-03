import { Schema, model } from "mongoose";
import { IAdvance } from "../types";
import { generateDisplayId } from "../utils/generateId";

const AdvanceSchema = new Schema<IAdvance>({
  displayId: { type: String, unique: true, default: () => generateDisplayId("ADV") },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
  amount: { type: Number, required: true, min: 0 },
  remainingAdvance: { type: Number, required: true, min: 0 },
  date: { type: Date, default: Date.now },
});

export default model<IAdvance>("Advance", AdvanceSchema);
