import { Response } from "express";
import Customer from "../models/Customer";
import Bill from "../models/Bill";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";

async function outstandingFor(customerId: string): Promise<number> {
  const bills = await Bill.find({ customerId }).select("remainingBalance");
  return bills.reduce((s, b) => s + Number(b.remainingBalance || 0), 0);
}

export const listCustomers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { q } = req.query;
  const filter: any = {};
  if (q) {
    const regex = new RegExp(String(q), "i");
    filter.$or = [{ fullName: regex }, { city: regex }, { phone: regex }];
  }
  const customers = await Customer.find(filter).sort({ createdAt: -1 }).lean();
  const withOutstanding = await Promise.all(
    customers.map(async (c: any) => ({ ...c, outstanding: await outstandingFor(c._id) }))
  );
  return ok(res, withOutstanding, "Customers fetched.");
});

export const getCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) return fail(res, "Customer not found.", 404);
  const outstanding = await outstandingFor(req.params.id);
  return ok(res, { ...customer, outstanding }, "Customer fetched.");
});

export const createCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fullName, city, phone } = req.body;
  if (!fullName || !city || !phone) {
    return fail(res, "fullName, city and phone are required.", 400);
  }
  const customer = await Customer.create({ fullName, city, phone });
  return created(res, customer, "Customer added.");
});

export const updateCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fullName, city, phone } = req.body;
  const customer = await Customer.findById(req.params.id);
  if (!customer) return fail(res, "Customer not found.", 404);

  if (fullName !== undefined) customer.fullName = fullName;
  if (city !== undefined) customer.city = city;
  if (phone !== undefined) customer.phone = phone;
  await customer.save();
  return ok(res, customer, "Customer updated.");
});

export const deleteCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const customer = await Customer.findByIdAndDelete(req.params.id);
  if (!customer) return fail(res, "Customer not found.", 404);
  return ok(res, null, "Customer deleted.");
});
