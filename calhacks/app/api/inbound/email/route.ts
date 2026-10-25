import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { fromPostmark } from "@/lib/email/parse";
import { receiveEmail } from "@/lib/email/service";
import { bump } from "@/lib/live/signal";
import { ROUTE_TOPICS } from "@/lib/live/routeTopics";
import { errorResponse } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

function tokenOk(given: string | null) {
  const secret = process.env.INBOUND_EMAIL_SECRET ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// POST /api/inbound/email?token=INBOUND_EMAIL_SECRET   Postmark's inbound webhook (JSON)
// Answers right away so Postmark doesn't retry, then reads the email: a supplier's invoice is
// saved like a scanned one; an unknown sender's invoice and every customer order wait for the owner.
export async function POST(request: Request) {
  if (!tokenOk(new URL(request.url).searchParams.get("token"))) return errorResponse("Not allowed.", 401);
  const email = fromPostmark(await request.json().catch(() => null));
  if (!email) return errorResponse("That isn't an email.", 400);
  after(async () => {
    try {
      const db = await getSupabase();
      await receiveEmail(db, email);
      await bump(ROUTE_TOPICS["/api/inbound/email"]).catch(() => undefined);
    } catch (err) {
      console.error("Inbound email failed:", err);
    }
  });
  return Response.json({ ok: true });
}
