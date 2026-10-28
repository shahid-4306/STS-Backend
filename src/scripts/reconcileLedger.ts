/**
 * One-off audit / repair for records created BEFORE bills could be marked as
 * "carried forward" (Bill.absorbedIntoBillId).
 *
 * Before that field existed, every new bill copied the customer's open
 * balances into its own previousArrears but left the earlier bills' balances
 * open, so the same money was counted twice in "outstanding".
 *
 *   npm run reconcile            # DRY RUN: prints what would change, writes nothing
 *   npm run reconcile -- --apply # writes absorbedIntoBillId on the affected bills
 *
 * It only ever sets absorbedIntoBillId (never touches amounts, payments or
 * advances) and it is re-runnable. It also lists bills whose receivedAmount
 * doesn't match their Payment rows so you can review them by hand.
 *
 * Back up the database before running with --apply.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import Bill from "../models/Bill";
import Payment from "../models/Payment";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();

  const customerIds = await Bill.distinct("customerId");
  let toMark = 0;
  const marks: { bill: any; into: any }[] = [];

  for (const customerId of customerIds) {
    const bills = await Bill.find({ customerId }).sort({ date: 1, createdAt: 1 });
    let open: any[] = [];
    for (const b of bills) {
      if (b.absorbedIntoBillId) continue; // already handled
      if (Number(b.previousArrears) > 0 && open.length) {
        for (const prev of open) {
          if (Number(prev.remainingBalance) !== 0) marks.push({ bill: prev, into: b });
        }
        open = [];
      }
      open.push(b);
    }
  }
  toMark = marks.length;

  console.log(`\nBills that were carried forward into a later bill but are still counted: ${toMark}`);
  for (const m of marks) {
    console.log(`  ${m.bill.displayId} (remaining ${m.bill.remainingBalance}) -> ${m.into.displayId}`);
  }
  if (apply) {
    for (const m of marks) {
      await Bill.updateOne({ _id: m.bill._id }, { $set: { absorbedIntoBillId: m.into._id } });
    }
    console.log(`\nApplied: marked ${toMark} bill(s).`);
  } else if (toMark) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
  }

  // Review list: received amount vs. recorded payments.
  const sums = await Payment.aggregate([{ $group: { _id: "$billId", total: { $sum: "$receivedAmount" } } }]);
  const paid = new Map(sums.map((s: any) => [String(s._id), s.total as number]));
  const allBills = await Bill.find().select("displayId receivedAmount");
  const mismatched = allBills.filter((b) => Math.abs((paid.get(String(b._id)) || 0) - Number(b.receivedAmount || 0)) > 0.005);
  console.log(`\nBills whose received amount differs from the sum of their payment records (review manually): ${mismatched.length}`);
  for (const b of mismatched) {
    console.log(`  ${b.displayId}: received ${b.receivedAmount}, payments ${paid.get(String(b._id)) || 0}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
