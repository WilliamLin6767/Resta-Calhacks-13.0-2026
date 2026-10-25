import { parseItems } from "@/lib/inventory/http";
import { logWaste } from "@/lib/inventory/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";
import { requireOwner } from "@/lib/auth";

const SOURCES = ["voice", "manual"] as const;

// POST /api/inventory/waste   { "items": [{ "ingredient_id": 17, "qty": 3, "reason": "spoiled" }], "source": "voice" }
// Logs stock thrown out (reason: spoiled, expired, dropped, overcooked, returned, other).
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const items = parseItems(body.items);
  if (!items.length) return errorResponse("Nothing to save.", 400);
  const source = SOURCES.find((s) => s === body.source) ?? "manual";
  try {
    const saved = await logWaste(await getSupabase(), items, source);
    signalAfter("/api/inventory/waste");
    return Response.json({ saved });
  } catch (err) {
    return handleError(err);
  }
}
