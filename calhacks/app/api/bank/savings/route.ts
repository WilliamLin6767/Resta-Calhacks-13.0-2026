import { moveToSavings } from "@/lib/bank/cashPlan";
import { NessieError } from "@/lib/bank/nessie";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/bank/savings   { "amount": 500 }
// The owner approved moving this much from the SIMULATED operating account to a simulated savings account.
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) return errorResponse("Send an amount.", 400);
  try {
    await moveToSavings(await getSupabase(), amount);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof NessieError) return errorResponse(err.message, err.status);
    return handleError(err);
  }
}
