import { clientIp, createRateLimiter } from "@/lib/aiLimits";
import { errorResponse } from "@/lib/purchasing/http";

// Each check reads the Gmail inbox: a few a minute is plenty
const perVisitor = createRateLimiter({ limit: 6, windowMs: 60 * 1000 });

// POST /api/inbound/check   "Check email now": asks the Gmail script (integrations/gmail, deployed as a
// web app at GMAIL_CHECK_URL) to send new mail right away instead of within the minute. The emails
// then arrive at /api/inbound/email as usual. Returns { sent }: how many new emails it found.
export async function POST(request: Request) {
  const url = process.env.GMAIL_CHECK_URL;
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!url || !secret) return errorResponse("Checking now isn't set up: add GMAIL_CHECK_URL (see integrations/gmail/README.md).", 400);
  const limit = perVisitor(clientIp(request));
  if (!limit.ok) return errorResponse(`Checked a moment ago. Try again in ${limit.retryAfterSeconds} seconds.`, 429);
  let res: Response;
  try {
    // Google answers with a redirect to the script's result, which fetch follows
    res = await fetch(`${url}?token=${encodeURIComponent(secret)}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  } catch {
    return errorResponse("Couldn't reach the Gmail script. New mail still arrives within a minute.", 502);
  }
  const data = await res.json().catch(() => null) as { ok?: boolean; sent?: number; busy?: boolean; error?: string } | null;
  if (!data) return errorResponse("The Gmail script didn't answer as expected. Is it deployed as a web app with access for Anyone?", 502);
  if (!data.ok) return errorResponse(data.error === "Not allowed." ? "The Gmail script refused: its secret doesn't match INBOUND_EMAIL_SECRET." : (data.error ?? "The Gmail script failed."), 502);
  return Response.json({ sent: data.sent ?? 0, busy: !!data.busy });
}
