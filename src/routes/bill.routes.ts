import { Router } from "express";
import { listBills, getBill, createBill, updateBill, getCustomerBillingContext } from "../controllers/bill.controller";
import { saveInvoiceImage, listInvoiceImagesForBill } from "../controllers/invoiceImage.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/", listBills);
router.get("/context/:customerId", getCustomerBillingContext);
router.get("/:id", getBill);
router.post("/", createBill);
router.put("/:id", updateBill);

router.post("/:id/invoice-images", saveInvoiceImage);
router.get("/:id/invoice-images", listInvoiceImagesForBill);

export default router;
