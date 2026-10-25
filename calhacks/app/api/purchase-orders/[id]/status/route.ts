import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { setOrderStatus } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";

// At most 20 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

// POST /api/purchase-orders/2/status   { "status": "approved" }
// draft -> approved or cancelled, approved -> sent or cancelled, sent -> received or cancelled
export async function POST(request: Request, ctx: RouteContext<"/api/purchase-orders/[id]/status">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown order.", 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.status !== "string") return errorResponse("Send a status.", 400);
  try {
    const db = await getSupabase();
    // Approving and sending spend money, so they go through the approval gate and its log.
    if (body.status === "approved" || body.status === "sent") {
      const tool = body.status === "approved" ? "approve_purchase_order" : "send_purchase_order";
      await ownerAction(db, { tool, title: `${body.status === "approved" ? "Approve" : "Send"} order #${id}`, summary: `${body.status === "approved" ? "Approved" : "Sent"} purchase order #${id} on the Invoices page.`, args: { order_id: id } }, sessionLabel(request));
    } else {
      await setOrderStatus(db, id, body.status);
    }
    signalAfter("/api/purchase-orders/[id]/status");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
