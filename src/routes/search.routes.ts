import { Router } from "express";
import { globalSearch } from "../controllers/search.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/", globalSearch);

export default router;
