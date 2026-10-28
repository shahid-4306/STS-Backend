import { Response } from "express";
import mongoose from "mongoose";
import InvoiceImage from "../models/InvoiceImage";
import Bill from "../models/Bill";
import { asyncHandler } from "../utils/asyncHandler";
import { ok, created, fail } from "../utils/apiResponse";
import { AuthRequest } from "../types";
import { saveBase64Image, deleteStoredImage, readStoredImage, InvalidImagePayloadError } from "../utils/fileStorage";

/**
 * Adds the download URL. Images are served from /api/invoice-images/:id/file,
 * which reads the copy kept in MongoDB (falling back to the disk copy for
 * images saved before that existed), so they still load after a redeploy or
 * serverless cold start. The raw bytes are never included in JSON responses.
 */
function withUrl(doc: any) {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.data;
  return { ...obj, url: `/api/invoice-images/${obj._id}/file` };
}

/**
 * Persists a snapshot of an invoice (captured client-side as a base64 PNG/JPEG
 * data URI) to disk under uploads/invoices/, and records a reference to it
 * against the bill it belongs to so it can be accessed again later.
 */
export const saveInvoiceImage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: billId } = req.params;
  const { fileName, imageBase64, contentType } = req.body;

  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return fail(res, "Invalid billId.", 400);
  }
  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    return fail(res, "fileName is required.", 400);
  }

  const bill = await Bill.findById(billId);
  if (!bill) return fail(res, "Bill not found.", 404);

  let stored;
  try {
    stored = saveBase64Image(imageBase64, billId);
  } catch (err) {
    if (err instanceof InvalidImagePayloadError) {
      return fail(res, err.message, err.status);
    }
    // Disk write failures, etc. — treat as a server error rather than a bad request.
    console.error("[invoiceImage] Failed to save image to disk:", err);
    return fail(res, "Could not save the invoice image on the server. Please try again.", 500);
  }

  // Sanitize the display file name defensively (client already sanitizes, but never trust the client).
  const safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150) || stored.storedFileName;

  let image;
  try {
    image = await InvoiceImage.create({
      billId: bill._id,
      customerId: bill.customerId,
      fileName: safeFileName,
      storedFileName: stored.storedFileName,
      relativePath: stored.relativePath,
      contentType: contentType && ALLOWED(contentType) ? contentType : stored.contentType,
      sizeBytes: stored.sizeBytes,
      data: stored.buffer,
    });
  } catch (err) {
    // If the DB write fails after the file was already written, clean up the orphaned file.
    deleteStoredImage(stored.storedFileName);
    throw err;
  }

  return created(res, withUrl(image), "Invoice image saved.");
});

function ALLOWED(contentType: string): boolean {
  return ["image/png", "image/jpeg", "image/jpg"].includes(contentType);
}

/** Lightweight metadata list of saved invoice images for a given bill. */
export const listInvoiceImagesForBill = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id: billId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return fail(res, "Invalid billId.", 400);
  }
  const images = await InvoiceImage.find({ billId }).sort({ createdAt: -1 });
  return ok(res, images.map(withUrl), "Invoice images fetched.");
});

/** Fetches a single saved invoice image's metadata (including its download URL). */
export const getInvoiceImage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { imageId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(imageId)) {
    return fail(res, "Invalid image id.", 400);
  }
  const image = await InvoiceImage.findById(imageId);
  if (!image) return fail(res, "Invoice image not found.", 404);
  return ok(res, withUrl(image), "Invoice image fetched.");
});

/** Deletes a saved invoice image, both its DB record and the file on disk. */
export const deleteInvoiceImage = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { imageId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(imageId)) {
    return fail(res, "Invalid image id.", 400);
  }
  const image = await InvoiceImage.findById(imageId);
  if (!image) return fail(res, "Invoice image not found.", 404);

  deleteStoredImage(image.storedFileName);
  await image.deleteOne();
  return ok(res, null, "Invoice image deleted.");
});

/**
 * Streams the saved image itself. Public (no bearer token) so it can be used
 * directly as an <img>/download link, like the old /uploads static path was;
 * access relies on the unguessable image id.
 */
export const serveInvoiceImageFile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { imageId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(imageId)) {
    return fail(res, "Invalid image id.", 400);
  }
  const image = await InvoiceImage.findById(imageId).select("+data");
  if (!image) return fail(res, "Invoice image not found.", 404);

  const bytes = image.data && image.data.length ? image.data : readStoredImage(image.storedFileName);
  if (!bytes) {
    return fail(res, "The file for this image is no longer available on the server.", 404);
  }
  res.setHeader("Content-Type", image.contentType || "image/png");
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  return res.status(200).send(bytes);
});
