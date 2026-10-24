import { errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { applyAction } from "@/lib/calls/service";
import { getSupabase } from "@/lib/supabase";
import { syncCallsAfter } from "@/lib/live/signal";

// POST /api/calls/12/apply   { action: "resolve_flags" | "record_price" | "mark_po_sent" }
// A suggested action after a call, clicked by the owner. Calls never change invoices,
// prices or orders on their own.
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/apply">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.action !== "string") return errorResponse("Say which action.", 400);
  try {
    const db = await getSupabase();
    await applyAction(db, id, body.action);
    syncCallsAfter(db, [id], "/api/calls/[id]/apply");
    return Response.json({ ok: true });
  } catch (err) {
    return handleCallError(err);
  }
}
