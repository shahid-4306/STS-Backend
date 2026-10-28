import { Router } from "express";
import { getDashboardSummary } from "../controllers/dashboard.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/summary", getDashboardSummary);

export default router;
