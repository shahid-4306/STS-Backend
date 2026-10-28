import { Response } from "express";
import Notification from "../models/Notification";
import { asyncHandler } from "../utils/asyncHandler";
import { ok } from "../utils/apiResponse";
import { AuthRequest } from "../types";

export const listNotifications = asyncHandler(async (req: AuthRequest, res: Response) => {
  const notifications = await Notification.find().sort({ createdAt: -1 }).limit(60);
  return ok(res, notifications, "Notifications fetched.");
});

export const markAllRead = asyncHandler(async (req: AuthRequest, res: Response) => {
  await Notification.updateMany({ read: false }, { $set: { read: true } });
  return ok(res, null, "All notifications marked as read.");
});
