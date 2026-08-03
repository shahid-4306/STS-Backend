import { Schema, model } from "mongoose";

/**
 * Generic atomic counter, one document per sequence name (e.g. "bill").
 * Used to generate sequential, human-readable, collision-proof numbers
 * (invoice numbers, etc.) instead of random display IDs.
 */
interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export default model<ICounter>("Counter", CounterSchema);
