import { ChangeSchema, undoChange } from "@/lib/agent/undo";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// POST /api/agent/undo   { change: <a change the chat showed, with its undo payload> }
// The chat's Undo button: the same code as the agent's undo_change (lib/agent/undo.ts). Only stock
// counts and waste can be undone; both set the stock back through the same service as a count.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const parsed = ChangeSchema.safeParse(body?.change);
  if (!parsed.success || !parsed.data.undo) return errorResponse("That change can't be undone.", 400);
  try {
    const result = await undoChange(await getSupabase(), parsed.data.undo, [parsed.data], "manual");
    if (!result.ok) return errorResponse(result.error, 400);
    return Response.json({ ok: true, change: result.change });
  } catch (err) {
    return handleError(err);
  }
}
