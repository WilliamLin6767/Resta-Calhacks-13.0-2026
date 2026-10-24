import { aiLimited } from "@/lib/inventory/http";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { explainPlan } from "@/lib/purchasing/planAi";
import { parsePlanRequest } from "@/lib/purchasing/planHttp";
import { buildPlan } from "@/lib/purchasing/planService";
import { getSupabase } from "@/lib/supabase";

// POST /api/orders/plan   { "kind": "low" }  or  { "kind": "prep", "date": "2026-10-24", "factors": { "1": 1.3 } }
// Which supplier to order each item from, compared on price, delivery date and minimums, with Claude's
// explanation. Nothing is saved. If the AI part fails, the plan still comes back without it.
export async function POST(request: Request) {
  const req = parsePlanRequest(await request.json().catch(() => ({})));
  if (!req) return errorResponse("Say what to plan: low stock, or a prep day in the next week.", 400);
  try {
    const { plan, label } = await buildPlan(await getSupabase(), req);
    let explanation = null;
    let explainError = "";
    if (plan.groups.length && !aiLimited(request)) {
      try {
        explanation = await explainPlan(plan, label);
      } catch (err) {
        explainError = err instanceof Error ? err.message : "The AI explanation isn't available.";
      }
    }
    return Response.json({ plan, explanation, explain_error: explainError });
  } catch (err) {
    return handleError(err);
  }
}
