import { Router } from "express";
import { listAdvances, createAdvance } from "../controllers/advance.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/", listAdvances);
router.post("/", createAdvance);

export default router;
