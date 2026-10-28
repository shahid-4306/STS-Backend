/**
 * End-to-end API integration tests. They boot the real Express app against a
 * REAL MongoDB and exercise bills, groups, advances, arrears, payments,
 * payment history and invoice images the way the frontend does.
 *
 *   MONGO_URI=mongodb://127.0.0.1:27017/sts_test npm test
 *
 * SAFETY: the database named in MONGO_URI is DROPPED before the run, so this
 * refuses to start unless the database name ends in "_test".
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test_secret";
process.env.DEFAULT_ADMIN_EMAIL = "test-admin@example.com";
process.env.DEFAULT_ADMIN_PASSWORD = "test-password-1";

const uri = process.env.MONGO_URI || "";
const dbName = uri.split("?")[0].split("/").pop() || "";
if (!uri || !dbName.endsWith("_test")) {
  console.error('Refusing to run: set MONGO_URI to a database whose name ends in "_test".');
  process.exit(2);
}

type Json = any;
let base = "";
let token = "";

async function api(method: string, url: string, body?: unknown, auth = true): Promise<{ status: number; json: Json }> {
  const res = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: Json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err: any) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err?.message?.split("\n")[0]}`);
    if (process.env.VERBOSE) console.log(err);
  }
}

// 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_URI = `data:image/png;base64,${PNG_B64}`;

async function main() {
  const mongoose = (await import("mongoose")).default;
  const { connectDB } = await import("../config/db");
  const { seedAdmin } = await import("../utils/seedAdmin");
  const { default: app } = await import("../app");
  const { UPLOADS_ROOT } = await import("../utils/fileStorage");

  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all(mongoose.modelNames().map((m) => mongoose.model(m).syncIndexes()));
  await seedAdmin();

  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const money = (n: number) => Math.round(n * 100) / 100;

  // ---------------------------------------------------------------- auth
  console.log("\nAuth");
  await test("rejects requests without a token", async () => {
    const r = await api("GET", "/bills", undefined, false);
    assert.equal(r.status, 401);
  });
  await test("logs in", async () => {
    const r = await api("POST", "/auth/login", { email: "test-admin@example.com", password: "test-password-1" }, false);
    assert.equal(r.status, 200);
    token = r.json.data.token;
    assert.ok(token);
  });

  // ---------------------------------------------------------------- fixtures
  console.log("\nCustomers & products (search)");
  let cust: Json, other: Json, pA: Json, pB: Json, pC: Json;
  await test("creates customers and products", async () => {
    cust = (await api("POST", "/customers", { fullName: "Waqas Traders", city: "Karachi", phone: "0300-1111111" })).json.data;
    other = (await api("POST", "/customers", { fullName: "Other Co", city: "Lahore", phone: "0300-2222222" })).json.data;
    pA = (await api("POST", "/products", { customerId: cust._id, countNumber: "20/1", type: "Cotton", description: "Blue Yarn", qtyPerPacket: "12", rate: 100 })).json.data;
    pB = (await api("POST", "/products", { customerId: cust._id, countNumber: "30/2", type: "Poly", description: "Red Thread (Fine)", qtyPerPacket: "x-large", rate: 250 })).json.data;
    pC = (await api("POST", "/products", { customerId: other._id, countNumber: "40/1", type: "Silk", description: "Other Product", qtyPerPacket: "5", rate: 999 })).json.data;
    assert.ok(pA._id && pB._id && pC._id);
  });
  await test("search matches name", async () => {
    const r = await api("GET", `/products?customerId=${cust._id}&q=blue`);
    assert.deepEqual(r.json.data.map((p: Json) => p._id), [pA._id]);
  });
  await test("search matches count number / type / pack size", async () => {
    assert.deepEqual((await api("GET", `/products?customerId=${cust._id}&q=${encodeURIComponent("30/2")}`)).json.data.map((p: Json) => p._id), [pB._id]);
    assert.deepEqual((await api("GET", `/products?customerId=${cust._id}&q=poly`)).json.data.map((p: Json) => p._id), [pB._id]);
    assert.deepEqual((await api("GET", `/products?customerId=${cust._id}&q=12`)).json.data.map((p: Json) => p._id), [pA._id]);
  });
  await test("search with regex characters does not crash and matches literally", async () => {
    const r = await api("GET", `/products?customerId=${cust._id}&q=${encodeURIComponent("Thread (")}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.map((p: Json) => p._id), [pB._id]);
    const r2 = await api("GET", `/products?customerId=${cust._id}&q=${encodeURIComponent("[*")}`);
    assert.equal(r2.status, 200);
    assert.equal(r2.json.data.length, 0);
  });
  await test("search never leaks another customer's products", async () => {
    const r = await api("GET", `/products?customerId=${cust._id}&q=other`);
    assert.equal(r.json.data.length, 0);
  });

  // ---------------------------------------------------------------- bills + groups
  console.log("\nBills with named people");
  let billA: Json;
  const reqId1 = "req-test-1";
  await test("creates a bill with ungrouped lines and two named people; totals + totalQty computed server-side", async () => {
    const r = await api("POST", "/bills", {
      customerId: cust._id,
      biltiNumber: "BL-1",
      driverName: "Naseer",
      date: "2026-03-05",
      clientRequestId: reqId1,
      groups: [
        { groupId: "grp-a", personName: "  Ahmed " },
        { groupId: "grp-b", personName: "Bilal" },
      ],
      items: [
        { productId: pA._id, packets: 2, groupId: "" },
        { productId: pA._id, packets: 3, groupId: "grp-a" },
        { productId: pB._id, packets: 1, groupId: "grp-b" },
      ],
      discount: 0,
      receivedAmount: 0,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    billA = r.json.data;
    assert.equal(billA.subtotal, 2 * 100 + 3 * 100 + 250);
    assert.equal(billA.grandTotal, 750);
    assert.equal(billA.remainingBalance, 750);
    assert.deepEqual(billA.groups, [
      { groupId: "grp-a", personName: "Ahmed" },
      { groupId: "grp-b", personName: "Bilal" },
    ]);
    assert.deepEqual(billA.items.map((i: Json) => i.groupId), ["", "grp-a", "grp-b"]);
    assert.deepEqual(billA.items.map((i: Json) => i.totalQty), [24, 36, 1]); // 12*2, 12*3, non-numeric pack -> packets
    assert.deepEqual(billA.items.map((i: Json) => i.total), [200, 300, 250]);
  });
  await test("person names and groups are persisted and come back on a fresh GET", async () => {
    const r = await api("GET", `/bills/${billA._id}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.data.groups.length, 2);
    assert.equal(r.json.data.groups[0].personName, "Ahmed");
    assert.equal(r.json.data.items[1].groupId, "grp-a");
    const list = await api("GET", `/bills?customerId=${cust._id}`);
    assert.equal(list.json.data[0].groups[1].personName, "Bilal");
  });
  await test("bills can be searched by person name", async () => {
    const r = await api("GET", "/bills?q=bilal");
    assert.deepEqual(r.json.data.map((b: Json) => b._id), [billA._id]);
  });
  await test("same clientRequestId returns the same bill instead of creating a duplicate", async () => {
    const r = await api("POST", "/bills", { customerId: cust._id, clientRequestId: reqId1, items: [{ productId: pA._id, packets: 9 }] });
    assert.equal(r.status, 200);
    assert.equal(r.json.data._id, billA._id);
    const all = await api("GET", `/bills?customerId=${cust._id}`);
    assert.equal(all.json.data.length, 1);
  });
  await test("two simultaneous identical submissions create exactly one bill", async () => {
    const payload = { customerId: other._id, clientRequestId: "race-1", items: [{ productId: pC._id, packets: 1 }] };
    const [a, b] = await Promise.all([api("POST", "/bills", payload), api("POST", "/bills", payload)]);
    assert.ok([200, 201].includes(a.status) && [200, 201].includes(b.status));
    assert.equal(a.json.data._id, b.json.data._id);
    const all = await api("GET", `/bills?customerId=${other._id}`);
    assert.equal(all.json.data.length, 1);
    // tidy: this bill is not part of the later scenarios
    await mongoose.connection.collection("bills").deleteMany({ customerId: new mongoose.Types.ObjectId(other._id) });
  });
  await test("rejects: unknown group, empty person name, duplicate group, foreign product, negative charges, bad date", async () => {
    const base = { customerId: cust._id, items: [{ productId: pA._id, packets: 1 }] };
    const bad = async (patch: Json, msg: RegExp) => {
      const r = await api("POST", "/bills", { ...base, ...patch });
      assert.equal(r.status >= 400 && r.status < 500, true, JSON.stringify(patch));
      assert.match(r.json.message, msg);
    };
    await bad({ items: [{ productId: pA._id, packets: 1, groupId: "nope" }] }, /group that does not exist/);
    await bad({ groups: [{ groupId: "g1", personName: "   " }] }, /person name/i);
    await bad({ groups: [{ groupId: "g1", personName: "A" }, { groupId: "g1", personName: "B" }] }, /Duplicate/);
    await bad({ groups: [{ groupId: "bad id!", personName: "A" }] }, /valid groupId/);
    await bad({ items: [{ productId: pC._id, packets: 1 }] }, /does not belong/);
    await bad({ discount: -5 }, /zero or greater/);
    await bad({ date: "not-a-date" }, /valid bill date/);
    await bad({ items: [] }, /At least one/);
    const count = await api("GET", `/bills?customerId=${cust._id}`);
    assert.equal(count.json.data.length, 1, "no failed request may leave a bill behind");
  });
  await test("old-style bill (no groups, no groupId) still works and has empty groups", async () => {
    // Insert a legacy record straight into MongoDB, exactly as it was stored before groups existed.
    const legacy = await mongoose.connection.collection("bills").insertOne({
      displayId: "BILL-LEGACY",
      customerId: new mongoose.Types.ObjectId(other._id),
      date: new Date("2025-01-01"),
      items: [{ productId: new mongoose.Types.ObjectId(pC._id), productName: "Other Product", qtyPerPacket: "5", type: "Silk", unitPrice: 999, packets: 1, total: 999 }],
      subtotal: 999, discount: 0, deliveryCharges: 0, rentCharges: 0, extraCharges: 0, previousArrears: 0, advanceUsed: 0,
      grandTotal: 999, receivedAmount: 0, remainingBalance: 999, paymentMethod: "Cash", remarks: "", createdAt: new Date(),
    });
    const r = await api("GET", `/bills/${legacy.insertedId}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.groups, []);
    assert.equal(r.json.data.items[0].groupId, "");
    const o = await api("GET", `/customers/${other._id}`);
    assert.equal(o.json.data.outstanding, 999, "legacy bill without absorbedIntoBillId still counts as outstanding");
    await mongoose.connection.collection("bills").deleteOne({ _id: legacy.insertedId });
  });

  // ---------------------------------------------------------------- editing bills
  console.log("\nEditing a bill");
  await test("editing replaces groups/items and they persist", async () => {
    const r = await api("PUT", `/bills/${billA._id}`, {
      groups: [{ groupId: "grp-b", personName: "Bilal K" }],
      items: [
        { productId: pA._id, packets: 1, groupId: "" },
        { productId: pB._id, packets: 2, groupId: "grp-b" },
      ],
      receivedAmount: 0,
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const g = await api("GET", `/bills/${billA._id}`);
    assert.deepEqual(g.json.data.groups, [{ groupId: "grp-b", personName: "Bilal K" }]);
    assert.equal(g.json.data.subtotal, 100 + 500);
    assert.equal(g.json.data.grandTotal, 600);
    assert.equal(g.json.data.remainingBalance, 600);
    billA = g.json.data;
  });
  await test("a failed edit changes nothing", async () => {
    const r = await api("PUT", `/bills/${billA._id}`, { items: [{ productId: pA._id, packets: 1, groupId: "ghost" }], groups: [] });
    assert.equal(r.status, 400);
    const g = await api("GET", `/bills/${billA._id}`);
    assert.equal(g.json.data.grandTotal, 600);
    assert.equal(g.json.data.groups[0].personName, "Bilal K");
  });

  // ---------------------------------------------------------------- advances
  console.log("\nAdvances");
  let advBillId = "";
  await test("advance deposit validates input", async () => {
    assert.equal((await api("POST", "/advances", { customerId: cust._id, amount: 0 })).status, 400);
    assert.equal((await api("POST", "/advances", { customerId: "zzz", amount: 5 })).status, 400);
    assert.equal((await api("POST", "/advances", { customerId: new mongoose.Types.ObjectId().toString(), amount: 5 })).status, 404);
  });
  const custAdv = async () => {
    const r = await api("GET", `/bills/context/${cust._id}`);
    return r.json.data.availableAdvance as number;
  };
  await test("advance used on a bill is deducted once; editing refunds then re-applies without double deduction", async () => {
    const dep = await api("POST", "/advances", { customerId: cust._id, amount: 1000, date: "2026-03-01" });
    assert.equal(dep.status, 201);
    assert.equal(await custAdv(), 1000);

    // Bill B uses 400 of the advance. (Bill A is still open, so it also carries forward.)
    const b = await api("POST", "/bills", { customerId: cust._id, clientRequestId: "adv-1", date: "2026-03-10", items: [{ productId: pA._id, packets: 5 }], advanceUsed: 400, receivedAmount: 0 });
    assert.equal(b.status, 201, JSON.stringify(b.json));
    advBillId = b.json.data._id;
    assert.equal(b.json.data.advanceUsed, 400);
    assert.equal(await custAdv(), 600);

    // Duplicate submit must not deduct again.
    await api("POST", "/bills", { customerId: cust._id, clientRequestId: "adv-1", items: [{ productId: pA._id, packets: 5 }], advanceUsed: 400 });
    assert.equal(await custAdv(), 600);

    // Edit: use 150 instead. Pool = 600 + 400 (refund) - 150 = 850.
    const e = await api("PUT", `/bills/${advBillId}`, { items: [{ productId: pA._id, packets: 5 }], advanceUsed: 150, receivedAmount: 0 });
    assert.equal(e.status, 200);
    assert.equal(e.json.data.advanceUsed, 150);
    assert.equal(await custAdv(), 850);

    // Invalid edit leaves advance untouched.
    const bad = await api("PUT", `/bills/${advBillId}`, { items: [], advanceUsed: 999 });
    assert.equal(bad.status, 400);
    assert.equal(await custAdv(), 850);
  });

  // ---------------------------------------------------------------- carry forward / outstanding
  console.log("\nOutstanding balances & carry-forward");
  await test("an earlier bill's balance is carried forward once, not counted twice", async () => {
    const a = (await api("GET", `/bills/${billA._id}`)).json.data;
    const b = (await api("GET", `/bills/${advBillId}`)).json.data;
    assert.equal(a.absorbedIntoBillId, advBillId, "A carried into B");
    assert.equal(b.previousArrears, 600, "B carried A's 600");
    // B: subtotal 500 + prev 600 - adv 150 = 950
    assert.equal(b.grandTotal, 950);
    assert.equal(b.remainingBalance, 950);
    const c = await api("GET", `/customers/${cust._id}`);
    assert.equal(c.json.data.outstanding, 950, "customer owes B's balance only (not 600 + 950)");
    const ctx = await api("GET", `/bills/context/${cust._id}`);
    assert.equal(ctx.json.data.previousArrears, 950);
    const dash = await api("GET", "/dashboard/summary");
    assert.equal(dash.status, 200);
    assert.equal(dash.json.data.totalOutstanding, 950);
  });
  await test("absorbed bills drop out of the due/partial lists", async () => {
    const due = await api("GET", `/bills?customerId=${cust._id}&status=due`);
    assert.deepEqual(due.json.data.map((x: Json) => x._id), [advBillId]);
  });
  await test("editing a carried-forward bill keeps its brought-forward amount (no loss, no double count)", async () => {
    const e = await api("PUT", `/bills/${advBillId}`, { items: [{ productId: pA._id, packets: 6 }], advanceUsed: 150, receivedAmount: 0 });
    assert.equal(e.status, 200);
    assert.equal(e.json.data.previousArrears, 600);
    assert.equal(e.json.data.grandTotal, 600 + 600 - 150);
    const ctx = await api("GET", `/bills/context/${cust._id}?excludeBillId=${advBillId}`);
    assert.equal(ctx.json.data.previousArrears, 600);
    const c = await api("GET", `/customers/${cust._id}`);
    assert.equal(c.json.data.outstanding, 1050);
  });
  await test("manually entered arrears flow into the next bill once and stay through edits", async () => {
    const ar = await api("POST", "/arrears", { customerId: other._id, amount: 700, date: "2026-03-02", remarks: "Opening balance" });
    assert.equal(ar.status, 201);
    assert.equal((await api("GET", `/bills/context/${other._id}`)).json.data.previousArrears, 700);
    const b = await api("POST", "/bills", { customerId: other._id, clientRequestId: "arr-1", date: "2026-03-12", items: [{ productId: pC._id, packets: 1 }] });
    assert.equal(b.json.data.previousArrears, 700);
    assert.equal(b.json.data.grandTotal, 999 + 700);
    // consumed: not counted a second time
    assert.equal((await api("GET", `/bills/context/${other._id}`)).json.data.previousArrears, 1699);
    const arrears = await api("GET", `/arrears?customerId=${other._id}`);
    assert.equal(arrears.json.data[0].remainingArrears, 0);
    // editing the bill must keep the 700 it absorbed
    const e = await api("PUT", `/bills/${b.json.data._id}`, { items: [{ productId: pC._id, packets: 2 }] });
    assert.equal(e.json.data.previousArrears, 700);
    assert.equal(e.json.data.grandTotal, 1998 + 700);
    otherBillId = b.json.data._id;
  });

  // ---------------------------------------------------------------- payments
  console.log("\nPayments");
  let collected1: Json;
  await test("cannot collect more than is due, on a missing bill, or with a bad amount", async () => {
    const over = await api("POST", "/payments/collect", { billId: advBillId, amount: 99999 });
    assert.equal(over.status, 400);
    assert.match(over.json.message, /exceeds/);
    assert.equal((await api("POST", "/payments/collect", { billId: advBillId, amount: -1 })).status, 400);
    assert.equal((await api("POST", "/payments/collect", { billId: advBillId, amount: "abc" })).status, 400);
    assert.equal((await api("POST", "/payments/collect", { billId: new mongoose.Types.ObjectId().toString(), amount: 5 })).status, 404);
    const b = (await api("GET", `/bills/${advBillId}`)).json.data;
    assert.equal(b.receivedAmount, 0);
  });
  await test("collecting against a carried-forward bill is refused", async () => {
    const r = await api("POST", "/payments/collect", { billId: billA._id, amount: 10 });
    assert.equal(r.status, 409);
    assert.match(r.json.message, /carried forward/);
  });
  await test("collect payment reduces the balance exactly once, even when the request is re-sent", async () => {
    const r = await api("POST", "/payments/collect", { billId: advBillId, amount: 300, method: "Cash", requestId: "pay-1" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    collected1 = r.json.data;
    assert.equal(collected1.bill.receivedAmount, 300);
    assert.equal(collected1.bill.remainingBalance, 1050 - 300);
    const again = await api("POST", "/payments/collect", { billId: advBillId, amount: 300, method: "Cash", requestId: "pay-1" });
    assert.equal(again.status, 200);
    assert.equal(again.json.data.payment._id, collected1.payment._id);
    const b = (await api("GET", `/bills/${advBillId}`)).json.data;
    assert.equal(b.receivedAmount, 300);
    assert.equal(b.remainingBalance, 750);
    const pays = await api("GET", `/payments?customerId=${cust._id}`);
    assert.equal(pays.json.data.length, 1);
  });
  await test("two simultaneous collections can never push a bill below zero", async () => {
    // 750 due; two parallel payments of 500 -> exactly one may succeed.
    const [a, b] = await Promise.all([
      api("POST", "/payments/collect", { billId: advBillId, amount: 500, requestId: "par-1" }),
      api("POST", "/payments/collect", { billId: advBillId, amount: 500, requestId: "par-2" }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.equal(statuses[0], 201);
    assert.ok(statuses[1] >= 400, `second must fail, got ${statuses}`);
    const bill = (await api("GET", `/bills/${advBillId}`)).json.data;
    assert.equal(bill.remainingBalance, 250);
    assert.equal(bill.receivedAmount, 800);
    const pays = await api("GET", `/payments?customerId=${cust._id}`);
    const sum = pays.json.data.reduce((s: number, p: Json) => s + p.receivedAmount, 0);
    assert.equal(sum, 800, "payment rows add up to the bill's received amount");
  });
  await test("bill-creation payment + later collections reconcile: editing the bill does not double count", async () => {
    // Fresh bill for 'other' customer paid 500 at creation, then 200 collected later.
    const b = await api("POST", "/bills", { customerId: other._id, clientRequestId: "rc-1", date: "2026-03-20", items: [{ productId: pC._id, packets: 1 }], receivedAmount: 500, paymentMethod: "Cash" });
    assert.equal(b.status, 201);
    const id = b.json.data._id;
    const prev = b.json.data.previousArrears; // carried from the earlier 'other' bill
    assert.equal(b.json.data.grandTotal, 999 + prev);
    const c = await api("POST", "/payments/collect", { billId: id, amount: 200, requestId: "rc-pay" });
    assert.equal(c.status, 201);
    let bill = (await api("GET", `/bills/${id}`)).json.data;
    assert.equal(bill.receivedAmount, 700);

    // The edit form shows 700 (total received). Saving it unchanged must not change any amounts.
    const e = await api("PUT", `/bills/${id}`, { items: [{ productId: pC._id, packets: 1 }], receivedAmount: 700, paymentMethod: "Cash" });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    bill = e.json.data;
    assert.equal(bill.receivedAmount, 700);
    assert.equal(bill.remainingBalance, bill.grandTotal - 700);
    const pays = (await api("GET", `/payments?customerId=${other._id}`)).json.data.filter((p: Json) => (p.billId._id || p.billId) === id);
    assert.equal(pays.reduce((s: number, p: Json) => s + p.receivedAmount, 0), 700, "payments still sum to 700");
    assert.equal(pays.length, 2);
    assert.equal(pays.find((p: Json) => p.source === "bill").receivedAmount, 500);

    // Raising the total received by 100 changes only the creation payment.
    const e2 = await api("PUT", `/bills/${id}`, { items: [{ productId: pC._id, packets: 1 }], receivedAmount: 800 });
    assert.equal(e2.status, 200);
    const pays2 = (await api("GET", `/payments?customerId=${other._id}`)).json.data.filter((p: Json) => (p.billId._id || p.billId) === id);
    assert.equal(pays2.reduce((s: number, p: Json) => s + p.receivedAmount, 0), 800);

    // Lowering below what was collected later is refused, nothing changes.
    const e3 = await api("PUT", `/bills/${id}`, { items: [{ productId: pC._id, packets: 1 }], receivedAmount: 100 });
    assert.equal(e3.status, 400);
    assert.match(e3.json.message, /already been collected/);
    const after = (await api("GET", `/bills/${id}`)).json.data;
    assert.equal(after.receivedAmount, 800);
    reconBillId = id;
  });

  // ---------------------------------------------------------------- payment history
  console.log("\nCustomer payment history");
  await test("ledger contains payments, advance deposit, advance applied and has correct per-bill remaining balance", async () => {
    const r = await api("GET", `/payments/customer/${cust._id}/history`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const kinds = r.json.data.entries.map((e: Json) => e.kind);
    assert.equal(kinds.filter((k: string) => k === "payment").length, 2);
    assert.equal(kinds.filter((k: string) => k === "advance_deposit").length, 1);
    assert.equal(kinds.filter((k: string) => k === "advance_applied").length, 1);
    const pays = r.json.data.entries.filter((e: Json) => e.kind === "payment").sort((a: Json, b: Json) => a.paymentAmount - b.paymentAmount);
    // bill grandTotal = 1050 (after the edit): after 300 -> 750, after +500 -> 250
    assert.deepEqual(pays.map((p: Json) => [p.paymentAmount, p.remainingBalance]), [[300, 750], [500, 250]]);
    assert.equal(pays[0].billRef.startsWith("BILL-"), true);
    assert.equal(r.json.data.summary.payments, 800);
    assert.equal(r.json.data.summary.currentOutstanding, 250);
    assert.equal(r.json.data.summary.advancesDeposited, 1000);
    assert.equal(r.json.data.summary.advancesApplied, 150);
  });
  await test("only the selected customer's records are returned", async () => {
    const r = await api("GET", `/payments/customer/${other._id}/history`);
    assert.equal(r.status, 200);
    for (const e of r.json.data.entries) {
      assert.ok(e.billId === null || [otherBillId, reconBillId].includes(e.billId), "foreign bill leaked into history");
    }
    assert.ok(r.json.data.entries.some((e: Json) => e.kind === "arrears_adjustment" && e.adjustmentAmount === 700));
    assert.ok(!r.json.data.entries.some((e: Json) => e.kind === "advance_deposit"));
  });
  await test("date range is inclusive on both boundary days (UTC and Pakistan time)", async () => {
    // advance dated 2026-03-01 (stored at UTC midnight) and bill/advance-applied on 2026-03-10
    const only = async (qs: string) => (await api("GET", `/payments/customer/${cust._id}/history?${qs}`)).json;
    let j = await only("startDate=2026-03-01&endDate=2026-03-01");
    assert.deepEqual(j.data.entries.map((e: Json) => e.kind), ["advance_deposit"]);
    j = await only("startDate=2026-03-01&endDate=2026-03-01&tzOffset=-300");
    assert.deepEqual(j.data.entries.map((e: Json) => e.kind), ["advance_deposit"], "Karachi tz keeps the same calendar day");
    j = await only("startDate=2026-03-02&endDate=2026-03-09");
    assert.equal(j.data.entries.length, 0);
    j = await only("startDate=2026-03-10&endDate=2026-03-10");
    assert.deepEqual(j.data.entries.map((e: Json) => e.kind), ["advance_applied"]);
    j = await only("endDate=2026-03-01");
    assert.deepEqual(j.data.entries.map((e: Json) => e.kind), ["advance_deposit"]);
    j = await only("startDate=2026-03-10");
    assert.ok(j.data.entries.length >= 3);
    assert.equal(j.data.entries.some((e: Json) => e.kind === "advance_deposit"), false);
  });
  await test("today's payments appear when filtering by today's date in the caller's timezone", async () => {
    const tz = -300; // Pakistan: UTC+5
    const localToday = new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10);
    const j = (await api("GET", `/payments/customer/${cust._id}/history?startDate=${localToday}&endDate=${localToday}&tzOffset=${tz}`)).json;
    assert.equal(j.data.entries.filter((e: Json) => e.kind === "payment").length, 2);
    // a day later excludes them
    const tomorrow = new Date(Date.now() - tz * 60_000 + 86_400_000).toISOString().slice(0, 10);
    const k = (await api("GET", `/payments/customer/${cust._id}/history?startDate=${tomorrow}&endDate=${tomorrow}&tzOffset=${tz}`)).json;
    assert.equal(k.data.entries.filter((e: Json) => e.kind === "payment").length, 0);
  });
  await test("a range that cuts a bill's history still shows the right remaining balance", async () => {
    const localToday = new Date().toISOString().slice(0, 10);
    const j = (await api("GET", `/payments/customer/${cust._id}/history?startDate=${localToday}&endDate=${localToday}`)).json;
    const p500 = j.data.entries.find((e: Json) => e.kind === "payment" && e.paymentAmount === 500);
    assert.equal(p500.remainingBalance, 250);
  });
  await test("validates the range and ids", async () => {
    const h = (qs: string, id = cust._id) => api("GET", `/payments/customer/${id}/history?${qs}`);
    assert.equal((await h("startDate=2026-03-10&endDate=2026-03-01")).status, 400);
    assert.equal((await h("startDate=2026-02-31")).status, 400);
    assert.equal((await h("startDate=garbage")).status, 400);
    assert.equal((await h("endDate=03/10/2026")).status, 400);
    assert.equal((await h("tzOffset=99999")).status, 400);
    assert.equal((await h("", "not-an-id")).status, 400);
    assert.equal((await h("", new mongoose.Types.ObjectId().toString())).status, 404);
    assert.equal((await api("GET", `/payments?customerId=bad`)).status, 400);
    assert.equal((await api("GET", `/payments?date=bad`)).status, 400);
  });
  await test("empty history for a customer with no transactions", async () => {
    const fresh = (await api("POST", "/customers", { fullName: "Fresh", city: "X", phone: "1" })).json.data;
    const r = await api("GET", `/payments/customer/${fresh._id}/history`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data.entries, []);
    assert.equal(r.json.data.summary.currentOutstanding, 0);
  });
  await test("legacy list endpoint still works for all customers", async () => {
    const r = await api("GET", "/payments");
    assert.equal(r.status, 200);
    assert.ok(r.json.data.length >= 4);
  });

  // ---------------------------------------------------------------- images
  console.log("\nInvoice images");
  let img: Json;
  await test("saves an invoice image and returns a working URL; bad payloads are rejected", async () => {
    const r = await api("POST", `/bills/${advBillId}/invoice-images`, { fileName: "Waqas_BL-1_2026-03-10.png", imageBase64: PNG_URI, contentType: "image/png" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    img = r.json.data;
    assert.equal(img.data, undefined, "raw bytes must not be in the JSON");
    assert.match(img.url, /\/api\/invoice-images\/.+\/file$/);
    assert.equal((await api("POST", `/bills/${advBillId}/invoice-images`, { fileName: "x.png", imageBase64: "nope" })).status, 400);
    assert.equal((await api("POST", `/bills/${advBillId}/invoice-images`, { imageBase64: PNG_URI })).status, 400);
    assert.equal((await api("POST", `/bills/${new mongoose.Types.ObjectId().toString()}/invoice-images`, { fileName: "x.png", imageBase64: PNG_URI })).status, 404);
  });
  await test("image is listed for the bill and downloadable (no auth needed for the file itself)", async () => {
    const list = await api("GET", `/bills/${advBillId}/invoice-images`);
    assert.equal(list.json.data.length, 1);
    const res = await fetch(base.replace(/\/api$/, "") + img.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(bytes, Buffer.from(PNG_B64, "base64"));
  });
  await test("image survives losing the file on disk (ephemeral/serverless filesystem)", async () => {
    fs.rmSync(path.join(UPLOADS_ROOT, "invoices"), { recursive: true, force: true });
    const res = await fetch(base.replace(/\/api$/, "") + img.url);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG_B64, "base64"));
  });
  await test("image is still attached after the bill is edited and re-fetched", async () => {
    await api("PUT", `/bills/${advBillId}`, { items: [{ productId: pA._id, packets: 6 }], advanceUsed: 150, receivedAmount: 800 });
    const list = await api("GET", `/bills/${advBillId}/invoice-images`);
    assert.equal(list.json.data.length, 1);
    assert.equal(list.json.data[0]._id, img._id);
  });
  await test("deleting an image removes it; unknown ids 404", async () => {
    assert.equal((await api("DELETE", `/invoice-images/${img._id}`)).status, 200);
    assert.equal((await api("GET", `/invoice-images/${img._id}`)).status, 404);
    assert.equal((await fetch(base.replace(/\/api$/, "") + img.url)).status, 404);
  });

  // ---------------------------------------------------------------- done
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  void money;
}

let otherBillId = "";
let reconBillId = "";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
