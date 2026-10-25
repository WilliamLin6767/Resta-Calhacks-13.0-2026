import { executorsFor, LimitError } from "@/lib/agent/executors";
import { gateStore, ownerAction } from "@/lib/agent/gate";
import { propose, reject } from "@/lib/agent/actions";
import { requireOwner } from "@/lib/auth";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { createRateLimiter, limitResponse } from "@/lib/rateLimit";
import { sessionLabel } from "@/lib/session";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// Sending emails: a handful a minute is plenty
const perVisitor = createRateLimiter({ limit: 6, windowMs: 60 * 1000 });

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// POST /api/payout-claims   { decision: "send" | "reject", claim_key, title, to, subject, body }
// The owner's answer to a drafted payout claim (lib/accounting/claims.ts). Send: it goes out from the
// restaurant's Gmail (or, without the Gmail script, comes back as a mailto: to open). Reject: logged,
// and the draft is put away. Both are rows in the action log, tool send_payout_claim.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const tooMany = limitResponse(perVisitor, request);
  if (tooMany) return tooMany;
  const b = await request.json().catch(() => ({}));
  const decision = b.decision === "send" || b.decision === "reject" ? b.decision : null;
  const claimKey = text(b.claim_key, 120);
  if (!decision || !/^(payout|bank):[a-z]+:\d{4}-\d{2}-\d{2}$/.test(claimKey)) return errorResponse("Send a decision and the claim.", 400);
  const to = text(b.to, 200);
  const subject = text(b.subject, 200);
  const title = text(b.title, 200) || subject;
  try {
    const db = await getSupabase();
    const owner = sessionLabel(request);
    const restaurant = ((await db.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle()).data as { name: string } | null)?.name ?? "";
    const args = { claim_key: claimKey, to, subject, body: text(b.body, 5000), from_name: restaurant };
    if (decision === "reject") {
      const store = gateStore(db);
      const row = await propose(store, { tool: "send_payout_claim", title, summary: `Decided not to send: ${subject}`, args, source: "owner", surface: "page" }, executorsFor(db));
      await reject(store, row.id, owner);
      return Response.json({ status: "rejected" });
    }
    const { result } = await ownerAction(db, { tool: "send_payout_claim", title, summary: `Emailed ${to}: ${subject}`, args }, owner);
    return Response.json({ status: result.sent ? "sent" : "opened", mailto: result.mailto ?? null });
  } catch (err) {
    if (err instanceof LimitError) return errorResponse(err.message, 400);
    return handleError(err);
  }
}
