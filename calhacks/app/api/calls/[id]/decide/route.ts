import { z } from "zod";
import { errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { supabaseStore } from "@/lib/calls/service";
import { BriefSchema } from "@/lib/calls/types";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { CallStartFailed } from "@/lib/agent/executors";
import { ownerAction } from "@/lib/agent/gate";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";
import { sessionLabel } from "@/lib/session";

// At most 5 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 5, windowMs: 60 * 1000 });

const BodySchema = z.object({ approve: z.boolean(), brief: BriefSchema.optional() });

// POST /api/calls/12/decide   { approve: true, brief?: <edited brief> }
// Only a pending request can be decided. Reject -> rejected. Approve -> the call is placed
// through Wajo right away (status calling), or failed with Wajo's error. Either way it goes
// through the approval gate (place_call or reject_call), so the action log has it.
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/decide">) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Send { approve: true or false } and, if edited, a valid brief.", 400);
  try {
    const db = await getSupabase();
    const call = await supabaseStore(db).get(id);
    if (!call) return errorResponse("Unknown call request.", 404);
    const about = `${call.title}`;
    await ownerAction(
      db,
      parsed.data.approve
        ? { tool: "place_call", title: `Call: ${about}`, summary: `Approved on the page: the AI caller places call request #${id}.`, args: { call_id: id, brief: parsed.data.brief } }
        : { tool: "reject_call", title: `Don't call: ${about}`, summary: `Turned down call request #${id} on the page.`, args: { call_id: id } },
      sessionLabel(request),
    );
    return Response.json({ call: await supabaseStore(db).get(id) });
  } catch (err) {
    if (err instanceof CallStartFailed) return Response.json({ call: err.call });
    return handleCallError(err);
  }
}
