import { orderAtRegister } from "@/lib/email/service";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/inbound/12/register   An accepted emailed order was rung up at the register: close it
// without recording a sale here, so it isn't counted twice.
export async function POST(_request: Request, ctx: RouteContext<"/api/inbound/[id]/register">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Bad email id.", 400);
  try {
    await orderAtRegister(await getSupabase(), id);
    signalAfter("/api/inbound/[id]/register");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
