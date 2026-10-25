import { confirmOrder } from "@/lib/email/service";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/inbound/12/confirm   The owner confirms a customer's emailed order: it's saved as a
// takeout sale, and its dishes come off stock.
export async function POST(_request: Request, ctx: RouteContext<"/api/inbound/[id]/confirm">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Bad email id.", 400);
  try {
    const saved = await confirmOrder(await getSupabase(), id);
    signalAfter("/api/inbound/[id]/confirm");
    return Response.json(saved);
  } catch (err) {
    return handleError(err);
  }
}
