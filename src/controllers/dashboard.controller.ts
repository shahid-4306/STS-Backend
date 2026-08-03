import { Response } from "express";
import Customer from "../models/Customer";
import Product from "../models/Product";
import Bill from "../models/Bill";
import { asyncHandler } from "../utils/asyncHandler";
import { ok } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const getDashboardSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  const [totalCustomers, totalProducts, totalBills, allBills] = await Promise.all([
    Customer.countDocuments(),
    Product.countDocuments(),
    Bill.countDocuments(),
    Bill.find().select("grandTotal remainingBalance date"),
  ]);

  const totalSales = allBills.reduce((s, b) => s + Number(b.grandTotal || 0), 0);
  const totalOutstanding = allBills.reduce((s, b) => s + Number(b.remainingBalance || 0), 0);

  const now = new Date();
  const todayStr = now.toDateString();
  const todaySales = allBills
    .filter((b) => new Date(b.date).toDateString() === todayStr)
    .reduce((s, b) => s + Number(b.grandTotal || 0), 0);

  const month = now.getMonth();
  const year = now.getFullYear();
  const monthlySales = allBills
    .filter((b) => {
      const d = new Date(b.date);
      return d.getMonth() === month && d.getFullYear() === year;
    })
    .reduce((s, b) => s + Number(b.grandTotal || 0), 0);

  const recentBills = await Bill.find()
    .populate("customerId", "fullName")
    .sort({ date: -1 })
    .limit(6);
  const recentCustomers = await Customer.find().sort({ createdAt: -1 }).limit(6);

  return ok(
    res,
    {
      totalCustomers,
      totalProducts,
      totalBills,
      totalSales,
      totalOutstanding,
      todaySales,
      monthlySales,
      recentBills,
      recentCustomers,
    },
    "Dashboard summary fetched."
  );
});
