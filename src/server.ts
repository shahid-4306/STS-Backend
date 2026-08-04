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

// Only start the server directly if this file is executed directly (e.g. node dist/server.js)
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  });
}

export { bootstrap };
