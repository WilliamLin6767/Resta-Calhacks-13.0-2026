import { readHeldInvoice } from "@/lib/email/service";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// POST /api/inbound/12/read   The owner trusts the sender: read the held invoice and save it, once.
// Returns { invoice_id, duplicate } (duplicate: it was already in the system, nothing added twice).
export async function POST(request: Request, ctx: RouteContext<"/api/inbound/[id]/read">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Bad email id.", 400);
  try {
    const saved = await readHeldInvoice(await getSupabase(), id);
    signalAfter("/api/inbound/[id]/read");
    return Response.json({ invoice_id: saved.id, duplicate: saved.duplicate });
  } catch (err) {
    return handleError(err);
  }
}
