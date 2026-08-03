import { Router } from "express";
import { listPayments, collectPayment } from "../controllers/payment.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/", listPayments);
router.post("/collect", collectPayment);

export default router;
