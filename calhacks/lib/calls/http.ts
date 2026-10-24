// Shared bits for the /api/calls routes: error responses and AI rate limits.

import { z } from "zod";
import { AiError } from "@/lib/purchasing/ai";
import { errorResponse } from "@/lib/purchasing/http";
import { clientIp, createRateLimiter, type RateLimitResult } from "@/lib/rateLimit";
import { WajoError } from "@/lib/wajo/client";
import { CallError } from "./service";

export { errorResponse, parseId } from "@/lib/purchasing/http";

// Turns anything thrown while handling a request into { error: "..." } with a fitting status.
export function handleCallError(err: unknown) {
  if (err instanceof CallError || err instanceof AiError) return errorResponse(err.message, err.status);
  if (err instanceof WajoError) return errorResponse(err.message, 502);
  if (err instanceof z.ZodError) return errorResponse("That brief isn't valid. Check every field has text and limits are numbers.", 400);
  const message = err instanceof Error ? err.message : "Something went wrong.";
  console.error(err);
  return errorResponse(message, 500);
}

// Each scan or owner request is a paid AI call and there's no login yet, so limit
// them like the other AI routes: per visitor per 10 minutes, and per day for the app.
const perVisitor = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
const daily = createRateLimiter({ limit: 100, windowMs: 24 * 60 * 60 * 1000 });

// A 429 response when over the limit, or null to go ahead.
export function aiRateLimit(request: Request): Response | null {
  for (const result of [perVisitor(clientIp(request)), daily("all")] as RateLimitResult[]) {
    if (!result.ok) {
      return Response.json(
        { error: `Too many AI requests. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minutes.` },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    }
  }
  return null;
}
