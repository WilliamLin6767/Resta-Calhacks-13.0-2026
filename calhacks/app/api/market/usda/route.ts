import { refreshResponse, refreshUsda } from "@/lib/market/refresh";
import { clientIp } from "@/lib/rateLimit";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// POST /api/market/usda
// Fetches the cached USDA livestock and dairy reports and stores them (lib/market/refresh.ts).
// Does not write supplier_prices.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  return refreshResponse(await refreshUsda(await getSupabase(), clientIp(request)));
}
