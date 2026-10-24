import { closeDispute, markSent, saveDraft } from "@/lib/purchasing/disputeService";
import { errorResponse, handleError, parseId } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/disputes/3   { "action": "save" | "sent", "to_email", "subject", "body", "save_email" }
//                        { "action": "credited", "credited": 160 }  or  { "action": "refused" }
export async function POST(request: Request, ctx: RouteContext<"/api/disputes/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return errorResponse("Unknown dispute.", 404);
  const b = await request.json().catch(() => ({}));
  const edits = {
    to_email: typeof b.to_email === "string" ? b.to_email.trim().slice(0, 200) : "",
    subject: typeof b.subject === "string" ? b.subject.slice(0, 300) : "",
    body: typeof b.body === "string" ? b.body.slice(0, 5000) : "",
  };
  try {
    const db = await getSupabase();
    if (b.action === "save") await saveDraft(db, id, edits);
    else if (b.action === "sent") await markSent(db, id, edits, b.save_email === true);
    else if (b.action === "credited" || b.action === "refused") await closeDispute(db, id, b.action, Number(b.credited) || 0);
    else return errorResponse("action must be save, sent, credited or refused.", 400);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
