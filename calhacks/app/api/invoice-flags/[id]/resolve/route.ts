import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";

// POST /api/invoice-flags/12/resolve   Marks a problem as dealt with.
export async function POST(request: Request, ctx: RouteContext<"/api/invoice-flags/[id]/resolve">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown flag.", 404);
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from("invoice_flags").update({ resolved: true }).eq("id", id);
    if (error) return errorResponse(`Could not update the flag: ${error.message}`, 500);
    signalAfter("/api/invoice-flags/[id]/resolve");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
