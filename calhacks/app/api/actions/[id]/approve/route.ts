import { requireOwner } from "@/lib/auth";
import { ActionError, ActionTableMissing } from "@/lib/agent/actions";
import { approveAndRun } from "@/lib/agent/gate";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";
import { sessionLabel } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";

// At most 10 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

// POST /api/actions/12/approve   { "confirm": true }
// The owner's tap: approves the proposal and runs it now, exactly once. The response is the
// action with its final status (done with result, or failed with error). Only the owner's
// session can call this; the agent never can.
export async function POST(request: Request, ctx: RouteContext<"/api/actions/[id]/approve">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown action." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.confirm !== true) return Response.json({ error: 'Send { "confirm": true } to approve.' }, { status: 400 });
  try {
    const action = await approveAndRun(await getSupabase(), id, sessionLabel(request));
    return Response.json({ action });
  } catch (err) {
    if (err instanceof ActionError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof ActionTableMissing) return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Could not approve that." }, { status: 500 });
  }
}
