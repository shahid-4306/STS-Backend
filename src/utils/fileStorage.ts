import fs from "fs";
import path from "path";
import crypto from "crypto";

export const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");
export const INVOICES_DIR = path.join(UPLOADS_ROOT, "invoices");

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB safety ceiling per invoice snapshot

export function ensureUploadDirs(): void {
  if (!fs.existsSync(INVOICES_DIR)) {
    fs.mkdirSync(INVOICES_DIR, { recursive: true });
  }
}

export class InvalidImagePayloadError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidImagePayloadError";
  }
}

/**
 * Validates and decodes a base64 data URI (e.g. "data:image/png;base64,....."),
 * writes it to backend/uploads/invoices/, and returns everything needed to
 * persist a reference to it.
 */
export function saveBase64Image(
  imageBase64: string,
  billId: string
): { storedFileName: string; relativePath: string; url: string; contentType: string; sizeBytes: number } {
  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    throw new InvalidImagePayloadError("imageBase64 is required.");
  }

  const match = imageBase64.match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/);
  if (!match) {
    throw new InvalidImagePayloadError(
      "imageBase64 must be a valid PNG or JPEG data URI (e.g. 'data:image/png;base64,...')."
    );
  }

  const contentType = match[1];
  const base64Data = match[2];
  const extension = ALLOWED_MIME_TYPES[contentType];
  if (!extension) {
    throw new InvalidImagePayloadError(`Unsupported image type: ${contentType}`);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch {
    throw new InvalidImagePayloadError("imageBase64 could not be decoded — the data appears corrupted.");
  }

  if (!buffer.length) {
    throw new InvalidImagePayloadError("The decoded image is empty.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new InvalidImagePayloadError(
      `Image is too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum allowed is 8MB.`
    );
  }

  ensureUploadDirs();

  const safeBillId = String(billId).replace(/[^a-zA-Z0-9]/g, "");
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const storedFileName = `invoice-${safeBillId}-${uniqueSuffix}.${extension}`;
  const absolutePath = path.join(INVOICES_DIR, storedFileName);

  try {
    fs.writeFileSync(absolutePath, buffer);
  } catch (err) {
    throw new Error(`Failed to write invoice image to disk: ${(err as Error).message}`);
  }

  return {
    storedFileName,
    relativePath: `invoices/${storedFileName}`,
    url: `/uploads/invoices/${storedFileName}`,
    contentType,
    sizeBytes: buffer.length,
  };
}

/** Removes a previously stored invoice image file from disk, if it exists. Never throws. */
export function deleteStoredImage(storedFileName: string): void {
  try {
    const absolutePath = path.join(INVOICES_DIR, storedFileName);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (err) {
    console.error("[fileStorage] Failed to delete stored image:", storedFileName, err);
  }
}
