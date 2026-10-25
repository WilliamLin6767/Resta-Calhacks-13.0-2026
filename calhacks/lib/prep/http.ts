import { clientIp, createRateLimiter } from "@/lib/aiLimits";
import { addDays, todayLocal } from "./service";

// Each prep adjustment costs an AI request, so limit how often it can run (POST /api/prep/adjust
// and the chat agent's adjust_prep_for_day share these).
const perVisitorLimit = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
const dailyLimit = createRateLimiter({ limit: 100, windowMs: 24 * 60 * 60 * 1000 });

// The reason it's limited, or null to go ahead.
export function prepAiLimit(identity: string): string | null {
  for (const result of [perVisitorLimit(identity), dailyLimit("all")]) {
    if (!result.ok) return `Too many AI requests. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minutes.`;
  }
  return null;
}

export { clientIp };

// A prep day must be YYYY-MM-DD, from tomorrow to a week ahead. Returns null otherwise.
export function parsePrepDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const today = todayLocal();
  return value > today && value <= addDays(today, 7) ? value : null;
}
