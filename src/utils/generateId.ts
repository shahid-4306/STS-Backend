/**
 * Generates short human-friendly display IDs (e.g. CUST-1a2b3c) similar to
 * the original prototype's uid() helper. These are stored alongside the
 * MongoDB _id and are what the UI shows to the user.
 */
export function generateDisplayId(prefix: string): string {
  const time = Date.now().toString(36).slice(-5);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${time}${rand}`.toUpperCase();
}

/**
 * Generates a sequential, zero-padded, collision-proof display ID (e.g.
 * BILL-000001, BILL-000002, ...) backed by an atomic Counter document.
 * Used for invoice numbers, where a predictable, readable sequence matters
 * more than the short random IDs used elsewhere (customers/products/etc).
 */
export async function generateSequentialId(
  sequenceName: string,
  prefix: string,
  padLength = 6,
): Promise<string> {
  const Counter = (await import("../models/Counter")).default;
  const counter = await Counter.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const seq = String(counter.seq).padStart(padLength, "0");
  return `${prefix}-${seq}`;
}
