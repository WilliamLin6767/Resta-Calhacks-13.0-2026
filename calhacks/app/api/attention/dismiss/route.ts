import { dismiss } from "@/lib/attention/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

// POST /api/attention/dismiss   { "key": "low", "fingerprint": "17,1,16" }
// Hides an alert in the "Needs you" bar until it changes (a different fingerprint shows again).
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  if (typeof b.key !== "string" || typeof b.fingerprint !== "string" || !b.key) return errorResponse("Send the alert's key and fingerprint.", 400);
  try {
    await dismiss(await getSupabase(), b.key, b.fingerprint);
    signalAfter("/api/attention/dismiss");
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
