import { Router } from "express";
import { getInvoiceImage, deleteInvoiceImage, serveInvoiceImageFile } from "../controllers/invoiceImage.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Public on purpose (declared before requireAuth): lets the browser load or
// download the picture directly. The image id is an unguessable ObjectId.
router.get("/:imageId/file", serveInvoiceImageFile);

router.use(requireAuth);

router.get("/:imageId", getInvoiceImage);
router.delete("/:imageId", deleteInvoiceImage);

export default router;
