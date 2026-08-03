import { Schema, model } from "mongoose";
import { IInvoiceImage } from "../types";

/**
 * Stores a reference to a downloaded invoice snapshot every time one is
 * generated from the invoice preview screen. The actual PNG/JPEG file lives
 * on disk under backend/uploads/invoices/ (served statically at
 * /uploads/invoices/<storedFileName>); this record is what ties that file
 * back to the bill and customer it belongs to.
 */
const InvoiceImageSchema = new Schema<IInvoiceImage>(
  {
    billId: { type: Schema.Types.ObjectId, ref: "Bill", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    // Human-friendly name (e.g. "Waqas_Traders_BL-4471_2026-07-12.png"), shown in the UI.
    fileName: { type: String, required: true, trim: true },
    // The actual, collision-proof name the file is saved under on disk.
    storedFileName: { type: String, required: true, unique: true },
    // Path relative to the uploads root, e.g. "invoices/invoice-<id>-<ts>.png".
    relativePath: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

InvoiceImageSchema.index({ billId: 1 });

export default model<IInvoiceImage>("InvoiceImage", InvoiceImageSchema);
