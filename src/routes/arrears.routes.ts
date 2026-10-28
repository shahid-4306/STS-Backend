import { Router } from "express";
import {
  listArrears,
  getArrears,
  createArrears,
  updateArrears,
  deleteArrears,
} from "../controllers/arrears.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/", listArrears);
router.get("/:id", getArrears);
router.post("/", createArrears);
router.put("/:id", updateArrears);
router.delete("/:id", deleteArrears);

export default router;
