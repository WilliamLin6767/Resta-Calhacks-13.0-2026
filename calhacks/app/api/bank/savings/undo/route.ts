import { undoLastMove } from "@/lib/bank/cashPlan";
import { NessieError } from "@/lib/bank/nessie";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";

// At most 10 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

// POST /api/bank/savings/undo
// Puts the last move to savings back in the operating account.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  try {
    await undoLastMove(await getSupabase());
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NessieError) return errorResponse(err.message, err.status);
    return handleError(err);
  }
}
