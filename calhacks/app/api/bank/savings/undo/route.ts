import { undoLastMove } from "@/lib/bank/cashPlan";
import { NessieError } from "@/lib/bank/nessie";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/bank/savings/undo
// Puts the last move to savings back in the operating account.
export async function POST() {
  try {
    await undoLastMove(await getSupabase());
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NessieError) return errorResponse(err.message, err.status);
    return handleError(err);
  }
}
