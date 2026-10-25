import { refreshResponse, refreshThomasNet } from "@/lib/market/refresh";
import { clientIp } from "@/lib/rateLimit";
import { getSupabase } from "@/lib/supabase";

// POST /api/market/thomasnet
// Finds outside companies with a phone for ingredients whose price jumped (lib/market/refresh.ts).
// Area CN is California North. Does not write suppliers or place a call.
export async function POST(request: Request) {
  return refreshResponse(await refreshThomasNet(await getSupabase(), clientIp(request)));
}
