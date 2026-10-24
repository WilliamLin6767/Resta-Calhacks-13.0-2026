import { markBillPaid } from "@/lib/accounting/service";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

// POST /api/invoices/12/paid
// The owner paid this supplier invoice (status = 'paid', paid_at = today).
export async function POST(_request: Request, ctx: RouteContext<"/api/invoices/[id]/paid">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown invoice.", 404);
  try {
    await markBillPaid(await getSupabase(), id);
    signalAfter("/api/invoices/[id]/paid");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
