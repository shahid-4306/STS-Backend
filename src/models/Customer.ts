import { Schema, model } from "mongoose";
import { ICustomer } from "../types";
import { generateDisplayId } from "../utils/generateId";

const CustomerSchema = new Schema<ICustomer>(
  {
    displayId: { type: String, unique: true, default: () => generateDisplayId("CUST") },
    fullName: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CustomerSchema.index({ fullName: "text", city: "text", phone: "text" });

export default model<ICustomer>("Customer", CustomerSchema);
