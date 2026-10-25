import { declineOrder } from "@/lib/email/service";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// POST /api/inbound/12/decline   The owner turns down an emailed order, or an unknown sender's invoice.
export async function POST(request: Request, ctx: RouteContext<"/api/inbound/[id]/decline">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Bad email id.", 400);
  try {
    await declineOrder(await getSupabase(), id);
    signalAfter("/api/inbound/[id]/decline");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
