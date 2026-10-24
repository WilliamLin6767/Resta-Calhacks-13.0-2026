import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { markUpdated, SYSTEMS, type System } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

// POST /api/price-changes/7/updated   { "system": "doordash" }
// The owner has changed this price in the POS, DoorDash or Uber Eats too.
export async function POST(request: Request, ctx: RouteContext<"/api/price-changes/[id]/updated">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown price change.", 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.system !== "string" || !Object.hasOwn(SYSTEMS, body.system)) return errorResponse("system must be pos, doordash or ubereats.", 400);
  try {
    await markUpdated(await getSupabase(), id, body.system as System);
    signalAfter("/api/price-changes/[id]/updated");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
