import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { setOrderStatus } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

// POST /api/purchase-orders/2/status   { "status": "approved" }
// draft -> approved or cancelled, approved -> sent or cancelled, sent -> received or cancelled
export async function POST(request: Request, ctx: RouteContext<"/api/purchase-orders/[id]/status">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown order.", 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.status !== "string") return errorResponse("Send a status.", 400);
  try {
    await setOrderStatus(await getSupabase(), id, body.status);
    signalAfter("/api/purchase-orders/[id]/status");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
