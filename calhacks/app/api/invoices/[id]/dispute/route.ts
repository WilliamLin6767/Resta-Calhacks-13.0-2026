import { aiLimited } from "@/lib/inventory/http";
import { startDispute } from "@/lib/purchasing/disputeService";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/invoices/12/dispute
// Claude drafts a dispute email for the invoice's open billing errors. Nothing is sent:
// the owner edits it and sends it from their own email. Returns the open dispute if there is one.
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/dispute">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown invoice.", 404);
  const limited = aiLimited(request);
  if (limited) return limited;
  try {
    return Response.json(await startDispute(await getSupabase(), id));
  } catch (err) {
    return handleError(err);
  }
}
