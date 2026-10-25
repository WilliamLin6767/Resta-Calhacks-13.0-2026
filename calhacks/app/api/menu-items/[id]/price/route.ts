import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { requireOwner } from "@/lib/auth";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";

// At most 20 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

// POST /api/menu-items/3/price   { "price": 18.75, "reason": "Brisket went up" }
// The owner approves a new in-house price. Logged in menu_price_changes.
export async function POST(request: Request, ctx: RouteContext<"/api/menu-items/[id]/price">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown dish.", 404);
  const body = await request.json().catch(() => ({}));
  const price = Number(body.price);
  if (!Number.isFinite(price)) return errorResponse("Send a price.", 400);
  try {
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "";
    await ownerAction(await getSupabase(), { tool: "set_menu_price", title: `Menu price to $${price.toFixed(2)}`, summary: `Set dish #${id}'s price to $${price.toFixed(2)} on the Menu page.`, args: { menu_item_id: id, new_price: price, reason } }, sessionLabel(request));
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
