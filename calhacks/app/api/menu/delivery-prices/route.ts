import { handleError } from "@/lib/purchasing/http";
import { applyDeliveryPrices } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";

// POST /api/menu/delivery-prices
// Sets every delivery-app price that's too low to the suggested one (see deliveryPlan in lib/pricing/pricing.ts).
export async function POST() {
  try {
    const changed = await applyDeliveryPrices(await getSupabase());
    return Response.json({ changed });
  } catch (err) {
    return handleError(err);
  }
}
