import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  DEFAULT_ADMIN_EMAIL: string;
  DEFAULT_ADMIN_PASSWORD: string;
  CORS_ORIGIN: string[];
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env: EnvConfig = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT) || 5000,
  MONGO_URI: required(
    "MONGO_URI",
    "mongodb+srv://FloodRelief:Masood%402003@completecoding.tlg9aay.mongodb.net/billdb?retryWrites=true&w=majority&appName=CompleteCoding",
  ),
  JWT_SECRET: required("JWT_SECRET", "millstone_dev_secret"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  DEFAULT_ADMIN_EMAIL:
    process.env.DEFAULT_ADMIN_EMAIL || "ststilespacers@gmail.com",
  DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD || "Masood@2003",
  CORS_ORIGIN: (process.env.CORS_ORIGIN || "http://localhost:4200")
    .split(",")
    .map((o) => o.trim()),
};
