import { z } from "zod";
import { errorResponse, handleCallError, parseId } from "@/lib/calls/http";
import { decideCall, supabaseStore } from "@/lib/calls/service";
import { BriefSchema } from "@/lib/calls/types";
import { getSupabase } from "@/lib/supabase";
import { createWajo } from "@/lib/wajo/client";

const BodySchema = z.object({ approve: z.boolean(), brief: BriefSchema.optional() });

// POST /api/calls/12/decide   { approve: true, brief?: <edited brief> }
// Only a pending request can be decided. Reject -> rejected. Approve -> the call is placed
// through Wajo right away (status calling), or failed with Wajo's error.
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/decide">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown call request.", 404);
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Send { approve: true or false } and, if edited, a valid brief.", 400);
  try {
    const row = await decideCall(supabaseStore(await getSupabase()), createWajo(), id, parsed.data);
    return Response.json({ call: row });
  } catch (err) {
    return handleCallError(err);
  }
}
