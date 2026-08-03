import { Request } from "express";
import { Document, Types } from "mongoose";

/* ============================================================
   ADMIN / AUTH
   ============================================================ */
export interface IAdmin extends Document {
  email: string;
  passwordHash: string;
  createdAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

export interface AuthRequest extends Request {
  admin?: {
    id: string;
    email: string;
  };
}

/* ============================================================
   CUSTOMER
   ============================================================ */
export interface ICustomer extends Document {
  displayId: string;
  fullName: string;
  city: string;
  phone: string;
  createdAt: Date;
}

/* ============================================================
   PRODUCT
   ============================================================ */
export interface IProduct extends Document {
  customerId: Types.ObjectId;
  countNumber: string;
  type: string;
  description: string;
  qtyPerPacket: string;
  rate: number;
  createdAt: Date;
}

/* ============================================================
   BILL
   ============================================================ */
export interface IBillItem {
  productId: Types.ObjectId | null;
  productName: string;
  qtyPerPacket: string;
  type: string;
  unitPrice: number;
  packets: number;
  total: number;
}

export interface IBill extends Document {
  displayId: string;
  customerId: Types.ObjectId;
  biltiNumber: string;
  driverName: string;
  driverPhone: string;
  date: Date;
  items: IBillItem[];
  subtotal: number;
  discount: number;
  deliveryCharges: number;
  rentCharges: number;
  extraCharges: number;
  previousArrears: number;
  advanceUsed: number;
  grandTotal: number;
  receivedAmount: number;
  remainingBalance: number;
  paymentMethod: string;
  remarks: string;
  createdAt: Date;
}

/* ============================================================
   PAYMENT
   ============================================================ */
export interface IPayment extends Document {
  displayId: string;
  customerId: Types.ObjectId;
  billId: Types.ObjectId;
  receivedAmount: number;
  paymentDate: Date;
  method: string;
  remarks: string;
}

/* ============================================================
   ADVANCE
   ============================================================ */
export interface IAdvance extends Document {
  displayId: string;
  customerId: Types.ObjectId;
  amount: number;
  remainingAdvance: number;
  date: Date;
}

/* ============================================================
   ARREARS (manually-entered customer arrears)
   ============================================================ */
export interface IArrears extends Document {
  displayId: string;
  customerId: Types.ObjectId;
  amount: number;
  remainingArrears: number;
  date: Date;
  remarks: string;
  createdAt: Date;
}

/* ============================================================
   INVOICE IMAGE
   ============================================================ */
export interface IInvoiceImage extends Document {
  billId: Types.ObjectId;
  customerId: Types.ObjectId;
  fileName: string;
  storedFileName: string;
  relativePath: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

/* ============================================================
   NOTIFICATION
   ============================================================ */
export interface INotification extends Document {
  message: string;
  type: string;
  read: boolean;
  createdAt: Date;
}
