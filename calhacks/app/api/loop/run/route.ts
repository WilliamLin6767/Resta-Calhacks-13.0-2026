import { requireOwner } from "@/lib/auth";
import { runTick } from "@/lib/loop/run";
import { CasesTableMissing } from "@/lib/loop/store";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 300;

// Each run can start up to 3 agent investigations, so at most 3 a minute.
const perVisitor = createRateLimiter({ limit: 3, windowMs: 60 * 1000 });

// POST /api/loop/run   the owner's "Run now" on the Actions page: the same tick as the cron,
// behind the owner's session instead of CRON_SECRET. Works without any cron at all.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  try {
    return Response.json(await runTick(await getSupabase()));
  } catch (err) {
    if (err instanceof CasesTableMissing) return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "The loop failed." }, { status: 500 });
  }
}
