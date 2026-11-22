import { Router } from "express";
import {
  listMonths,
  listMonthlyRecords,
  getMonthlyRecord,
  deleteMonthlyRecord,
  exportMonthlyRecords,
} from "../controllers/monthlyRecord.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

// Fixed paths first so they are not mistaken for a record id.
router.get("/months", listMonths);
router.get("/export", exportMonthlyRecords);
router.get("/", listMonthlyRecords);
router.get("/:id", getMonthlyRecord);
router.delete("/:id", deleteMonthlyRecord);

export default router;
