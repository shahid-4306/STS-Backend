import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware";
import { ensureUploadDirs, UPLOADS_ROOT } from "./utils/fileStorage";

import authRoutes from "./routes/auth.routes";
import customerRoutes from "./routes/customer.routes";
import productRoutes from "./routes/product.routes";
import billRoutes from "./routes/bill.routes";
import invoiceImageRoutes from "./routes/invoiceImage.routes";
import paymentRoutes from "./routes/payment.routes";
import advanceRoutes from "./routes/advance.routes";
import arrearsRoutes from "./routes/arrears.routes";
import notificationRoutes from "./routes/notification.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportRoutes from "./routes/report.routes";
import searchRoutes from "./routes/search.routes";

// Safely wrap directory creation so Vercel serverless read-only filesystem doesn't crash app
try {
  ensureUploadDirs();
} catch (err) {
  console.warn(
    "[serverless] Skipping local upload dir creation on read-only filesystem.",
  );
}

const app: Application = express();

// Robust CORS Options for Production & Vercel
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, curl, server-to-server)
    if (!origin) return callback(null, true);

    // Allow configured origins, Vercel frontend domains, and local development
    if (
      env.CORS_ORIGIN.includes("*") ||
      env.CORS_ORIGIN.includes(origin) ||
      origin.endsWith(".vercel.app") ||
      origin.includes("localhost")
    ) {
      return callback(null, true);
    }

    // Fallback pass to avoid blocking valid preflight requests
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
  ],
};

// Handle Pre-Flight OPTIONS requests explicitly across all endpoints
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

if (env.NODE_ENV !== "test") {
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.use("/uploads", express.static(UPLOADS_ROOT));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "TanveerLedger API is running.",
    env: env.NODE_ENV,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/invoice-images", invoiceImageRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/advances", advanceRoutes);
app.use("/api/arrears", arrearsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/search", searchRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
