import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { recheckInvoice } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";

// POST /api/invoices/12/check
// Matches any lines that aren't matched yet (asking the AI if needed) and re-runs every check.
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/check">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown invoice.", 404);
  try {
    const flags = await recheckInvoice(await getSupabase(), id);
    signalAfter("/api/invoices/[id]/check");
    return Response.json({ flags: flags.length });
  } catch (err) {
    return handleError(err);
  }
}
