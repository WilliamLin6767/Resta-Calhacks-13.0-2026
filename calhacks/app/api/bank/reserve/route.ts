import { setReserve } from "@/lib/bank/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/bank/reserve   { "amount": 1000 }
// How much cash the owner wants to keep in the bank at all times.
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) return errorResponse("Send an amount.", 400);
  try {
    await setReserve(await getSupabase(), amount);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
