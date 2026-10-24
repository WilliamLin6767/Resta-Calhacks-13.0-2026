import { aiRateLimit, handleCallError } from "@/lib/calls/http";
import { scanForCalls } from "@/lib/calls/service";
import { getSupabase } from "@/lib/supabase";
import { syncCallsAfter } from "@/lib/live/signal";

// POST /api/calls/scan   find supplier calls worth making (restaurant 1) and save them as
// pending requests for the owner to approve. Rules find candidates; one Claude call judges them.
// Returns { created: [{ id, title }], considered, noPhone: [{ supplier_name, summary, ... }] }.
export async function POST(request: Request) {
  const limited = aiRateLimit(request);
  if (limited) return limited;
  try {
    const db = await getSupabase();
    const result = await scanForCalls(db);
    syncCallsAfter(db, result.created.map((c) => c.id), "/api/calls/scan");
    return Response.json(result);
  } catch (err) {
    return handleCallError(err);
  }
}
