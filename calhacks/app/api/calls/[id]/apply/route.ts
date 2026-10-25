import { errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { getSupabase } from "@/lib/supabase";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { requireOwner } from "@/lib/auth";

// POST /api/calls/12/apply   { action: "resolve_flags" | "record_price" | "mark_po_sent" }
// A suggested action after a call, clicked by the owner. Calls never change invoices,
// prices or orders on their own.
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/apply">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  const body = await request.json().catch(() => ({}));
  if (typeof body.action !== "string") return errorResponse("Say which action.", 400);
  try {
    await ownerAction(await getSupabase(), { tool: "apply_call_result", title: `Apply call #${id}: ${body.action}`, summary: `Applied "${body.action}" from call #${id} on the page.`, args: { call_id: id, action: body.action } }, sessionLabel(request));
    return Response.json({ ok: true });
  } catch (err) {
    return handleCallError(err);
  }
}
