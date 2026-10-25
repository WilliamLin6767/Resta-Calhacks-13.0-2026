import { handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";
import { requireOwner } from "@/lib/auth";

// POST /api/menu/delivery-prices
// Sets every delivery-app price that's too low to the suggested one (see deliveryPlan in lib/pricing/pricing.ts).
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  try {
    const { result } = await ownerAction(await getSupabase(), { tool: "set_delivery_prices", title: "Raise delivery-app prices", summary: "Raised the delivery-app prices that were too low, on the Menu page.", args: {} }, sessionLabel(request));
    return Response.json({ changed: result.changed });
  } catch (err) {
    return handleError(err);
  }
}
