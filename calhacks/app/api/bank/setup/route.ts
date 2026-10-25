import { setupBank } from "@/lib/bank/service";
import { NessieError } from "@/lib/bank/nessie";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";

// At most 10 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

// POST /api/bank/setup
// Creates the demo restaurant's SIMULATED Capital One Nessie account and deposits each payout, once.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  try {
    await setupBank(await getSupabase());
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NessieError) return errorResponse(err.message, err.status);
    return handleError(err);
  }
}
