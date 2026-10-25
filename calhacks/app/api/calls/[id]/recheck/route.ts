import { after } from "next/server";
import { aiRateLimit, errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { recheckCall, supabaseStore } from "@/lib/calls/service";
import { checkSwitch } from "@/lib/calls/switching";
import { needsSwitchCheck } from "@/lib/calls/types";
import { getSupabase } from "@/lib/supabase";
import { createWajo } from "@/lib/wajo/client";
import { ROUTE_TOPICS } from "@/lib/live/routeTopics";
import { syncCalls, syncCallsAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";

// POST /api/calls/12/recheck   a finished call: read Wajo's latest report and conversation again
// and redo the result (for a report that came in after the app stopped checking).
// Only reads from Wajo; it never places a call. One Claude call, so rate limited.
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/recheck">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  const limited = aiRateLimit(request);
  if (limited) return limited;
  try {
    const db = await getSupabase();
    const row = await recheckCall(supabaseStore(db), createWajo(), id);
    // The supplier reported a supply problem: weigh switching suppliers after responding.
    // It may add a pending call to a new supplier; nothing is dialed.
    if (needsSwitchCheck(row)) {
      after(() =>
        checkSwitch(db, id)
          .then((check) => syncCalls(db, [id, check?.follow_up_call_id], { topics: ROUTE_TOPICS["/api/calls/[id]/recheck"] }))
          .catch((err) => console.error("Supplier switch check failed:", err))
      );
    }
    syncCallsAfter(db, [id], "/api/calls/[id]/recheck");
    return Response.json({ call: row });
  } catch (err) {
    return handleCallError(err);
  }
}
