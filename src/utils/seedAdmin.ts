import bcrypt from "bcryptjs";
import Admin from "../models/Admin";
import { env } from "../config/env";

export async function seedAdmin(): Promise<void> {
  const existing = await Admin.countDocuments();
  if (existing > 0) return;

  const passwordHash = await bcrypt.hash(env.DEFAULT_ADMIN_PASSWORD, 10);
  await Admin.create({ email: env.DEFAULT_ADMIN_EMAIL.toLowerCase(), passwordHash });
  console.log(`[seed] Default admin created -> ${env.DEFAULT_ADMIN_EMAIL} / ${env.DEFAULT_ADMIN_PASSWORD}`);
}
