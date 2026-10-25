import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";

// At most 10 a minute per visitor.
const perVisitor = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

// POST /api/bank/reserve   { "amount": 1000 }
// How much cash the owner wants to keep in the bank at all times.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const b = await request.json().catch(() => ({}));
  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) return errorResponse("Send an amount.", 400);
  try {
    await ownerAction(await getSupabase(), { tool: "bank_reserve", title: `Cash reserve to ${amount.toFixed(2)}`, summary: `Set the cash reserve to ${amount.toFixed(2)} on the Accounting page.`, args: { amount } }, sessionLabel(request));
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
