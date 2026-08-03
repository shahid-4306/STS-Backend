import { Router } from "express";
import { body } from "express-validator";
import { login, me, changePassword } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";

const router = Router();

router.post(
  "/login",
  [body("email").isEmail().withMessage("A valid email is required"), body("password").notEmpty()],
  validate,
  login
);

router.get("/me", requireAuth, me);

router.post(
  "/change-password",
  requireAuth,
  [body("currentPassword").notEmpty(), body("newPassword").isLength({ min: 6 })],
  validate,
  changePassword
);

export default router;
