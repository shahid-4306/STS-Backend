import { Schema, model } from "mongoose";
import { INotification } from "../types";

const NotificationSchema = new Schema<INotification>(
  {
    message: { type: String, required: true },
    type: { type: String, default: "info" },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default model<INotification>("Notification", NotificationSchema);
