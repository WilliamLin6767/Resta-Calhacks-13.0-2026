import { ACTION_STATUSES, ActionTableMissing, supabaseActions, type ActionStatus } from "@/lib/agent/actions";
import { getSupabase } from "@/lib/supabase";

// GET /api/actions?status=proposed&case_id=3   the action log, newest first (at most 100).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const caseId = Number(url.searchParams.get("case_id"));
  if (status && !(ACTION_STATUSES as readonly string[]).includes(status)) return Response.json({ error: `status must be one of ${ACTION_STATUSES.join(", ")}.` }, { status: 400 });
  try {
    const actions = await supabaseActions(await getSupabase()).list({ status: (status as ActionStatus) || undefined, case_id: Number.isInteger(caseId) && caseId > 0 ? caseId : undefined });
    return Response.json({ actions });
  } catch (err) {
    if (err instanceof ActionTableMissing) return Response.json({ actions: [], setup: err.message });
    return Response.json({ error: err instanceof Error ? err.message : "Could not load the actions." }, { status: 500 });
  }
}
