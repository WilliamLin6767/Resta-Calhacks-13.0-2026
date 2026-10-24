import { createClient } from "@supabase/supabase-js";
import { connection } from "next/server";

// The demo restaurant.
export const RESTAURANT_ID = 1;

// Rules:
// 1. Always use getSupabase() to get a client. It calls connection() first, so
//    queries run on every request instead of being frozen in at build time.
// 2. Because cacheComponents is on, any async server component that calls this
//    must be wrapped in <Suspense> by its parent.
export async function getSupabase() {
  await connection();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
