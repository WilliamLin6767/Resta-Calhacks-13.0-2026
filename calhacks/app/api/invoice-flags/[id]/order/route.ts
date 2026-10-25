import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { orderFromFlag } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";

// POST /api/invoice-flags/12/order
// Turns a "cheaper elsewhere" flag into a draft purchase order with that supplier,
// waiting for the owner's approval (purchase_orders.status = 'draft', created_by = 'ai').
export async function POST(request: Request, ctx: RouteContext<"/api/invoice-flags/[id]/order">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown flag.", 404);
  try {
    const orderId = await orderFromFlag(await getSupabase(), id);
    signalAfter("/api/invoice-flags/[id]/order");
    return Response.json({ purchase_order_id: orderId });
  } catch (err) {
    return handleError(err);
  }
}
