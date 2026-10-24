import { parseItems } from "@/lib/inventory/http";
import { logWaste } from "@/lib/inventory/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

const SOURCES = ["voice", "manual"] as const;

// POST /api/inventory/waste   { "items": [{ "ingredient_id": 17, "qty": 3, "reason": "spoiled" }], "source": "voice" }
// Logs stock thrown out (reason: spoiled, expired, dropped, overcooked, returned, other).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items = parseItems(body.items);
  if (!items.length) return errorResponse("Nothing to save.", 400);
  const source = SOURCES.find((s) => s === body.source) ?? "manual";
  try {
    return Response.json({ saved: await logWaste(await getSupabase(), items, source) });
  } catch (err) {
    return handleError(err);
  }
}
