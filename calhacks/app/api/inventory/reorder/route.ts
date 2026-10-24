import { reorderLow } from "@/lib/inventory/service";
import { handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/inventory/reorder
// Draft purchase orders (one per supplier) to bring every low item back to its par level.
export async function POST() {
  try {
    return Response.json({ created: await reorderLow(await getSupabase()) });
  } catch (err) {
    return handleError(err);
  }
}
