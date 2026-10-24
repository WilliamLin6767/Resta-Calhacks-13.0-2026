import { connection } from "next/server";
import { handleCallError } from "@/lib/calls/http";
import { pendingCounts } from "@/lib/calls/service";
import { getSupabase } from "@/lib/supabase";

// GET /api/calls/counts   pending requests per record and per sidebar section, for badges
export async function GET() {
  // Counts change all the time: mark this route as per-request before anything can fail,
  // so the build doesn't try to prerender it.
  await connection();
  try {
    return Response.json(await pendingCounts(await getSupabase()));
  } catch (err) {
    return handleCallError(err);
  }
}
