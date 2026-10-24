import { errorResponse, handleError } from "@/lib/purchasing/http";
import { parsePlanRequest } from "@/lib/purchasing/planHttp";
import { draftPlan } from "@/lib/purchasing/planService";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

// POST /api/orders/plan/draft   same body as /api/orders/plan
// Drafts the plan as one purchase order per supplier, waiting for the owner's approval on /invoices.
export async function POST(request: Request) {
  const req = parsePlanRequest(await request.json().catch(() => ({})));
  if (!req) return errorResponse("Say what to plan: low stock, or a prep day in the next week.", 400);
  try {
    const created = await draftPlan(await getSupabase(), req);
    signalAfter("/api/orders/plan/draft");
    return Response.json({ created });
  } catch (err) {
    return handleError(err);
  }
}
