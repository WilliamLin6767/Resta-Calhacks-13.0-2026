import { parsePrepDate } from "@/lib/prep/http";
import { orderShortfalls } from "@/lib/prep/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/prep/order   { "date": "2026-10-24", "factors": { "1": 1.2 } }
// Drafts one purchase order per supplier for everything that day is short on.
// factors = the AI adjustments the owner accepted (dish id -> factor); they're clamped to 0.5-2.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const date = parsePrepDate(body.date);
  if (!date) return errorResponse("Pick a day in the next week.", 400);
  const factors: Record<number, number> = {};
  if (body.factors && typeof body.factors === "object") {
    for (const [id, f] of Object.entries(body.factors)) if (Number.isInteger(Number(id)) && typeof f === "number") factors[Number(id)] = f;
  }
  try {
    const created = await orderShortfalls(await getSupabase(), date, factors);
    return Response.json({ created });
  } catch (err) {
    return handleError(err);
  }
}
