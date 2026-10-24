import { setupBank } from "@/lib/bank/service";
import { NessieError } from "@/lib/bank/nessie";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/bank/setup
// Creates the demo restaurant's SIMULATED Capital One Nessie account and deposits each payout, once.
export async function POST() {
  try {
    await setupBank(await getSupabase());
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NessieError) return errorResponse(err.message, err.status);
    return handleError(err);
  }
}
