import { acceptOrder } from "@/lib/email/service";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/inbound/12/confirm   The owner accepts a customer's emailed order. It's held for pickup,
// not a sale yet: that's recorded when it's paid for (picked-up, or register).
export async function POST(_request: Request, ctx: RouteContext<"/api/inbound/[id]/confirm">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Bad email id.", 400);
  try {
    await acceptOrder(await getSupabase(), id);
    signalAfter("/api/inbound/[id]/confirm");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
