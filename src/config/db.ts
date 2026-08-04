import mongoose from "mongoose";
import { env } from "./env";

// Cached connection interface for Serverless environments
let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  try {
    mongoose.set("strictQuery", true);
    const db = await mongoose.connect(env.MONGO_URI, {
      bufferCommands: false, // Prevents queries from buffering infinitely if connection drops
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = db.connections[0].readyState === 1;
    console.log(`[db] MongoDB connected -> ${mongoose.connection.name}`);
  } catch (err) {
    console.error("[db] MongoDB connection failed:", err);
    throw err;
  }
}
