import { Router } from "express";
import { getInvoiceImage, deleteInvoiceImage } from "../controllers/invoiceImage.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/:imageId", getInvoiceImage);
router.delete("/:imageId", deleteInvoiceImage);

export default router;
