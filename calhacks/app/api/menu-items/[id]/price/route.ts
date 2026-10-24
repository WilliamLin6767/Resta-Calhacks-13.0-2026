import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { changePrice } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";

// POST /api/menu-items/3/price   { "price": 18.75, "reason": "Brisket went up" }
// The owner approves a new in-house price. Logged in menu_price_changes.
export async function POST(request: Request, ctx: RouteContext<"/api/menu-items/[id]/price">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown dish.", 404);
  const body = await request.json().catch(() => ({}));
  const price = Number(body.price);
  if (!Number.isFinite(price)) return errorResponse("Send a price.", 400);
  try {
    await changePrice(await getSupabase(), id, price, typeof body.reason === "string" ? body.reason.slice(0, 500) : "");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
