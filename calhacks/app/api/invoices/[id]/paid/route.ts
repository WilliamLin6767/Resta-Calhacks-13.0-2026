import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { requireOwner } from "@/lib/auth";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";

// At most 20 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

// POST /api/invoices/12/paid
// The owner paid this supplier invoice (status = 'paid', paid_at = today).
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/paid">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown invoice.", 404);
  try {
    await ownerAction(await getSupabase(), { tool: "mark_invoice_paid", title: `Mark invoice #${id} paid`, summary: `Recorded invoice #${id} as paid on the Accounting page.`, args: { invoice_id: id } }, sessionLabel(request));
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
