import { Schema, model } from "mongoose";
import { IProduct } from "../types";

const ProductSchema = new Schema<IProduct>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    countNumber: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    qtyPerPacket: { type: String, required: true, trim: true },
    rate: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ProductSchema.index({ description: "text", type: "text" });
ProductSchema.index({ customerId: 1 });

export default model<IProduct>("Product", ProductSchema);

