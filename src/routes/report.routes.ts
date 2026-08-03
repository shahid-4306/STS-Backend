import { Router } from "express";
import {
  salesReport,
  ledgerReport,
  outstandingReport,
  productSalesReport,
  paymentReport,
  advanceReport,
} from "../controllers/report.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/sales", salesReport);
router.get("/ledger", ledgerReport);
router.get("/outstanding", outstandingReport);
router.get("/products", productSalesReport);
router.get("/payments", paymentReport);
router.get("/advances", advanceReport);

export default router;
