import { requireOwner } from "@/lib/auth";
import { ActionError, ActionTableMissing } from "@/lib/agent/actions";
import { rejectAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";

// POST /api/actions/12/reject   { "confirm": true }
// The owner turned the proposal down. Nothing runs, and the record it points at is untouched.
export async function POST(request: Request, ctx: RouteContext<"/api/actions/[id]/reject">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown action." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.confirm !== true) return Response.json({ error: 'Send { "confirm": true } to reject.' }, { status: 400 });
  try {
    const action = await rejectAction(await getSupabase(), id, sessionLabel(request));
    return Response.json({ action });
  } catch (err) {
    if (err instanceof ActionError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof ActionTableMissing) return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Could not reject that." }, { status: 500 });
  }
}
