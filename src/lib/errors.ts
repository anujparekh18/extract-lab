import { ConvexError } from "convex/values";

/** User-facing message for an error thrown by a Convex mutation. */
export function errorMessage(error: unknown) {
  if (error instanceof ConvexError) return String(error.data);
  if (error instanceof Error) {
    // Strip Convex's "[CONVEX M(...)] [Request ID: ...] Server Error" wrapper.
    const match = error.message.match(/Uncaught (?:Convex)?Error: (.+?)(?:\n|$)/);
    return match?.[1] ?? error.message;
  }
  return "Something went wrong.";
}
