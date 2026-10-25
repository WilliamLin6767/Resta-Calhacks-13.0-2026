import { liveEnabled } from "@/lib/live/client";
import { resyncAll } from "@/lib/live/signal";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

const perVisitor = createRateLimiter({ limit: 5, windowMs: 60 * 1000 });

// POST /api/live/resync   copies supplier calls (last 7 days, plus any still open) and the
// pending counts from Supabase to Convex, and wakes every open screen. For after Convex was
// off or missed something. Returns { ok: true, calls } or { ok: false, reason }.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  if (!liveEnabled()) return Response.json({ ok: false, reason: "convex not configured" });
  const limited = perVisitor(clientIp(request));
  if (!limited.ok) {
    return Response.json({ error: "Too many resyncs. Try again in a minute." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  return Response.json(await resyncAll(await getSupabase()));
}
