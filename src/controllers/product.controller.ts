import { Response } from "express";
import mongoose from "mongoose";
import Product from "../models/Product";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const listProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { q, customerId } = req.query;
  const filter: any = {};

  // Products are scoped to a customer. If a customerId is supplied, only
  // that customer's catalogue is returned. Without one, nothing is returned
  // (the frontend always passes customerId once a customer is selected).
  if (customerId) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      return fail(res, "Invalid customerId.", 400);
    }
    filter.customerId = customerId;
  }

  if (q) {
    const regex = new RegExp(String(q), "i");
    filter.$or = [{ description: regex }, { type: regex }];
  }
  const products = await Product.find(filter).sort({ createdAt: -1 });
  return ok(res, products, "Products fetched.");
});

export const getProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const product = await Product.findById(req.params.id);
  if (!product) return fail(res, "Product not found.", 404);
  return ok(res, product, "Product fetched.");
});

export const createProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, countNumber, type, description, qtyPerPacket, rate } = req.body;
  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
    return fail(res, "A valid customerId is required — products belong to a specific customer.", 400);
  }
  if (!countNumber || !type || !description || !qtyPerPacket || rate === undefined) {
    return fail(res, "All product fields are required.", 400);
  }
  const product = await Product.create({ customerId, countNumber, type, description, qtyPerPacket, rate });
  return created(res, product, "Product added.");
});

export const updateProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { countNumber, type, description, qtyPerPacket, rate } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) return fail(res, "Product not found.", 404);

  const priceChanged = rate !== undefined && Number(product.rate) !== Number(rate);

  // Note: customerId is intentionally not editable here — a product cannot
  // be reassigned to a different customer after creation. Delete and
  // re-create it under the correct customer instead.
  if (countNumber !== undefined) product.countNumber = countNumber;
  if (type !== undefined) product.type = type;
  if (description !== undefined) product.description = description;
  if (qtyPerPacket !== undefined) product.qtyPerPacket = qtyPerPacket;
  if (rate !== undefined) product.rate = rate;
  await product.save();

  if (priceChanged) {
    await Notification.create({
      message: `Price updated for "${product.description}" -> ${Number(rate).toLocaleString()}`,
      type: "price",
    });
  }

  return ok(res, product, "Product updated.");
});

export const deleteProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return fail(res, "Product not found.", 404);
  return ok(res, null, "Product deleted.");
});
