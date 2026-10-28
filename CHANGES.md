# Backend changes

* Bill: `groups[]` (named people) + `items[].groupId`, `items[].totalQty`; `absorbedIntoBillId`, `clientRequestId`.
* Payment: `source`, `requestId`. InvoiceImage: `data` (bytes kept in MongoDB).
* New: `GET /api/payments/customer/:customerId/history?startDate&endDate&tzOffset`
* New: `GET /api/invoice-images/:id/file` (serves the saved image from MongoDB).
* Product search (`GET /api/products?q=`) now matches name, count number, type, pack size; input is regex-escaped.
* Accounting fixes: see the hand-over notes (carry-forward double count, edit-bill payment double count, collect overpayment, idempotency).
* Tests: `MONGO_URI=mongodb://127.0.0.1:27017/sts_test npm test` (DB name must end in `_test`; it is dropped).
* Legacy data: `npm run reconcile` (dry run) / `npm run reconcile -- --apply`. Back up first.
