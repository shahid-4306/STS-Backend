import mongoose from "mongoose";
import { env } from "./env";

let isConnected = false;

export async function connectDB(): Promise<void> {
  // Reuse existing connection across Vercel serverless invocations
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  try {
    mongoose.set("strictQuery", true);

    const db = await mongoose.connect(env.MONGO_URI, {
      bufferCommands: false, // Prevents queries from buffering infinitely if offline
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      family: 4, // Force IPv4 DNS resolution on Vercel Node runtime
    });

    isConnected = db.connections[0].readyState === 1;
    console.log(`[db] MongoDB connected -> ${mongoose.connection.name}`);
  } catch (err) {
    console.error("[db] MongoDB connection failed:", err);
    throw err;
  }
}
