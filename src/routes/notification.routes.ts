import { Router } from "express";
import { listNotifications, markAllRead } from "../controllers/notification.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/", listNotifications);
router.post("/mark-all-read", markAllRead);

export default router;
