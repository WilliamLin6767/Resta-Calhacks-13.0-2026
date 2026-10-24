import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { recheckInvoice } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";

// POST /api/invoices/12/check
// Matches any lines that aren't matched yet (asking the AI if needed) and re-runs every check.
export async function POST(_request: Request, ctx: RouteContext<"/api/invoices/[id]/check">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown invoice.", 404);
  try {
    const flags = await recheckInvoice(await getSupabase(), id);
    return Response.json({ flags: flags.length });
  } catch (err) {
    return handleError(err);
  }
}
