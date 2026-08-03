import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import app from "./app";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { seedAdmin } from "./utils/seedAdmin";

async function bootstrap() {
  await connectDB();
  await seedAdmin();

  app.listen(env.PORT, () => {
    console.log(
      `[server] TanveerLedger API listening on http://localhost:${env.PORT}`,
    );
    console.log(`[server] Environment: ${env.NODE_ENV}`);
  });
}

bootstrap().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
