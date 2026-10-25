import { ActionTableMissing, supabaseActions } from "@/lib/agent/actions";
import { getSupabase } from "@/lib/supabase";

// GET /api/actions/12   one action, for its card.
export async function GET(_request: Request, ctx: RouteContext<"/api/actions/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown action." }, { status: 404 });
  try {
    const action = await supabaseActions(await getSupabase()).get(id);
    if (!action) return Response.json({ error: "That action isn't here." }, { status: 404 });
    return Response.json({ action });
  } catch (err) {
    if (err instanceof ActionTableMissing) return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Could not load the action." }, { status: 500 });
  }
}
