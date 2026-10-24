import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/invoice-flags/12/resolve   Marks a problem as dealt with.
export async function POST(_request: Request, ctx: RouteContext<"/api/invoice-flags/[id]/resolve">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown flag.", 404);
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from("invoice_flags").update({ resolved: true }).eq("id", id);
    if (error) return errorResponse(`Could not update the flag: ${error.message}`, 500);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
