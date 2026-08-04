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

ensureUploadDirs();

const app: Application = express();

// Enable CORS Pre-Flight across all routes
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // Check if origin matches allowed origins or allow vercel previews
    if (
      env.CORS_ORIGIN.includes("*") ||
      env.CORS_ORIGIN.includes(origin) ||
      origin.endsWith(".vercel.app")
    ) {
      return callback(null, true);
    }
    return callback(new Error("CORS policy error: Origin not allowed."));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Enable preflight handling for all routes

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
