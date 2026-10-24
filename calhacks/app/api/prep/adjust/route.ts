import { adjustForNote } from "@/lib/prep/ai";
import { parsePrepDate } from "@/lib/prep/http";
import { loadPrep } from "@/lib/prep/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { clientIp, createRateLimiter } from "@/lib/aiLimits";
import { getSupabase } from "@/lib/supabase";

// Each call costs an AI request, so limit how often it can run.
const perVisitorLimit = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
const dailyLimit = createRateLimiter({ limit: 100, windowMs: 24 * 60 * 60 * 1000 });

// POST /api/prep/adjust   { "date": "2026-10-24", "note": "Cal home game, big crowd after 5pm" }
// Returns Claude's per-dish factors for that day's forecast. Nothing is saved.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const date = parsePrepDate(body.date);
  if (!date) return errorResponse("Pick a day in the next week.", 400);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!note) return errorResponse("Write a note about the day first.", 400);
  for (const result of [perVisitorLimit(clientIp(request)), dailyLimit("all")]) {
    if (!result.ok) return errorResponse(`Too many AI requests. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minutes.`, 429);
  }
  try {
    const { forecast } = await loadPrep(await getSupabase(), date);
    if (forecast.closed) return errorResponse("The restaurant is closed that day.", 400);
    return Response.json(await adjustForNote(date, forecast.weekday, forecast.dishes, note));
  } catch (err) {
    return handleError(err);
  }
}
