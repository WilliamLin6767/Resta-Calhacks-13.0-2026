import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { SYSTEMS } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { requireOwner } from "@/lib/auth";

// POST /api/price-changes/7/updated   { "system": "doordash" }
// The owner has changed this price in the POS, DoorDash or Uber Eats too.
export async function POST(request: Request, ctx: RouteContext<"/api/price-changes/[id]/updated">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown price change.", 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.system !== "string" || !Object.hasOwn(SYSTEMS, body.system)) return errorResponse("system must be pos, doordash or ubereats.", 400);
  try {
    const system = body.system as keyof typeof SYSTEMS;
    await ownerAction(await getSupabase(), { tool: "mark_delivery_price_updated", title: `Price updated in ${SYSTEMS[system]}`, summary: `Recorded price change #${id} as made in ${SYSTEMS[system]}.`, args: { change_id: id, system } }, sessionLabel(request));
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
