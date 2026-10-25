import "server-only";
import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";

// The demo restaurant.
export const RESTAURANT_ID = 1;

// Rules:
// 1. Always use getSupabase() to get a client. It calls connection() first, so
//    queries run on every request instead of being frozen in at build time.
// 2. Because cacheComponents is on, any async server component that calls this
//    must be wrapped in <Suspense> by its parent.
// 3. Server only. It uses SUPABASE_SECRET_KEY, which bypasses row level security, so the
//    browser never talks to Supabase: every read and write goes through this server.
export async function getSupabase() {
  await connection();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serverKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let warned = false;

// The secret key. Development may fall back to the public anon key (with one warning), which
// stops working once supabase/17_lockdown.sql has closed the anon policies.
export function serverKey(env: Record<string, string | undefined> = process.env): string {
  if (env.SUPABASE_SECRET_KEY) return env.SUPABASE_SECRET_KEY;
  if (env.NODE_ENV === "production") throw new Error("SUPABASE_SECRET_KEY is not set. Add it to the server's environment.");
  if (!warned) {
    warned = true;
    console.warn("[supabase] SUPABASE_SECRET_KEY is not set: using the anon key. Fine for development only.");
  }
  return env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
}
