import { Response } from "express";
import bcrypt from "bcryptjs";
import Admin from "../models/Admin";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, fail } from "../utils/apiResponse";
import { signToken } from "../utils/jwt";
import { AuthRequest } from "../types";

export const login = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return fail(res, "Email and password are required.", 400);
  }

  const admin = await Admin.findOne({ email: String(email).toLowerCase().trim() });
  if (!admin) {
    return fail(res, "Invalid email or password.", 401);
  }

  const match = await admin.comparePassword(password);
  if (!match) {
    return fail(res, "Invalid email or password.", 401);
  }

  const token = signToken({ id: admin.id, email: admin.email });
  return ok(res, { token, admin: { id: admin.id, email: admin.email } }, "Login successful.");
});

export const me = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.admin) return fail(res, "Not authenticated.", 401);
  const admin = await Admin.findById(req.admin.id).select("-passwordHash");
  if (!admin) return fail(res, "Admin not found.", 404);
  return ok(res, admin, "Current admin fetched.");
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.admin) return fail(res, "Not authenticated.", 401);
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return fail(res, "Current and new password are required.", 400);
  }
  const admin = await Admin.findById(req.admin.id);
  if (!admin) return fail(res, "Admin not found.", 404);

  const match = await admin.comparePassword(currentPassword);
  if (!match) return fail(res, "Current password is incorrect.", 401);

  admin.passwordHash = await bcrypt.hash(newPassword, 10);
  await admin.save();
  return ok(res, null, "Password updated successfully.");
});
