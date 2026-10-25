import { after } from "next/server";
import { errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { pollCall, supabaseStore } from "@/lib/calls/service";
import { checkSwitch } from "@/lib/calls/switching";
import { needsSwitchCheck } from "@/lib/calls/types";
import { getSupabase } from "@/lib/supabase";
import { createWajo } from "@/lib/wajo/client";
import { ROUTE_TOPICS } from "@/lib/live/routeTopics";
import { syncCalls, syncCallsAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";

// GET /api/calls/12/status   the request, brought up to date. While the call runs this asks
// Wajo how it's going (at most once every 5 seconds per request), answers the caller's
// questions within the approved brief, and reads the result when the call is done.
export async function GET(request: Request, ctx: RouteContext<"/api/calls/[id]/status">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  try {
    const db = await getSupabase();
    const row = await pollCall(supabaseStore(db), createWajo(), id);
    // The supplier reported a supply problem: weigh switching suppliers after responding.
    // It may add a pending call to a new supplier; nothing is dialed.
    if (needsSwitchCheck(row)) {
      after(() =>
        checkSwitch(db, id)
          .then((check) => syncCalls(db, [id, check?.follow_up_call_id], { topics: ROUTE_TOPICS["/api/calls/[id]/status"] }))
          .catch((err) => console.error("Supplier switch check failed:", err))
      );
    }
    syncCallsAfter(db, [id], "/api/calls/[id]/status");
    return Response.json({ call: row });
  } catch (err) {
    return handleCallError(err);
  }
}
