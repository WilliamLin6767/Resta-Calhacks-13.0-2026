import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { confirmLine } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

// POST /api/invoice-lines/12/confirm
//   body: { "ingredient_id": 5 }  or  { "new_ingredient_name": "Oxtail", "new_ingredient_unit": "lb" }
// Says what an invoice line really is. Remembered for every future invoice from that supplier.
export async function POST(request: Request, ctx: RouteContext<"/api/invoice-lines/[id]/confirm">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown invoice line.", 404);
  const body = await request.json().catch(() => ({}));
  const ingredientId = body.ingredient_id == null ? undefined : Number(body.ingredient_id);
  const newName = typeof body.new_ingredient_name === "string" ? body.new_ingredient_name.trim() : "";
  if (!ingredientId && !newName) return errorResponse("Send ingredient_id or new_ingredient_name.", 400);
  try {
    const invoiceId = await confirmLine(await getSupabase(), id, {
      ingredient_id: ingredientId, new_ingredient_name: newName || undefined, new_ingredient_unit: body.new_ingredient_unit,
    });
    signalAfter("/api/invoice-lines/[id]/confirm");
    return Response.json({ invoice_id: invoiceId });
  } catch (err) {
    return handleError(err);
  }
}
