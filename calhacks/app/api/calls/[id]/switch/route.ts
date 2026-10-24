import { aiRateLimit, errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { supabaseStore } from "@/lib/calls/service";
import { checkSwitch } from "@/lib/calls/switching";
import { getSupabase } from "@/lib/supabase";

// POST /api/calls/12/switch   check again whether to switch suppliers after this call's supply
// problem (e.g. after adding APIFY_TOKEN so ThomasNet can be searched). Only when the last check
// didn't add a call to a new supplier. May add a PENDING call; never dials. Rate limited (Claude).
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/switch">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  const limited = aiRateLimit(request);
  if (limited) return limited;
  try {
    const db = await getSupabase();
    const check = await checkSwitch(db, id, { again: true });
    if (!check) return errorResponse("This call can't be checked again right now (a check is running, or it already suggested a new supplier).", 409);
    return Response.json({ call: await supabaseStore(db).get(id) });
  } catch (err) {
    return handleCallError(err);
  }
}
