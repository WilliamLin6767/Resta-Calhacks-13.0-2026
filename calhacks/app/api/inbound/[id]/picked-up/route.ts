import { orderPickedUp } from "@/lib/email/service";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// POST /api/inbound/12/picked-up   An accepted emailed order was picked up and paid outside the
// register: record it once as a takeout sale (its dishes come off stock).
export async function POST(request: Request, ctx: RouteContext<"/api/inbound/[id]/picked-up">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Bad email id.", 400);
  try {
    const saved = await orderPickedUp(await getSupabase(), id);
    signalAfter("/api/inbound/[id]/picked-up");
    return Response.json(saved);
  } catch (err) {
    return handleError(err);
  }
}
