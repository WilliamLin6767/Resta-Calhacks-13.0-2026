import { timingSafeEqual } from "node:crypto";
import { runTick } from "@/lib/loop/run";
import { CasesTableMissing } from "@/lib/loop/store";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 300; // up to 3 investigations, each a short agent run

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// GET or POST /api/loop/tick   Authorization: Bearer $CRON_SECRET
// One tick of the autonomous loop (lib/loop/engine.ts). Vercel Cron calls it with GET and sends
// the header itself; the proxy lets this path through without a session because of that check.
async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Not allowed." }, { status: 401 });
  try {
    return Response.json(await runTick(await getSupabase()));
  } catch (err) {
    if (err instanceof CasesTableMissing) return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "The loop failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
