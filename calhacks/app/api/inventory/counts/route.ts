import { parseItems } from "@/lib/inventory/http";
import { saveCounts } from "@/lib/inventory/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

const SOURCES = ["photo", "voice", "manual"] as const;

// POST /api/inventory/counts   { "items": [{ "ingredient_id": 1, "qty": 42 }], "source": "photo" }
// Saves confirmed counts: sets stock and records how far each was from what was expected.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const items = parseItems(body.items);
  if (!items.length) return errorResponse("Nothing to save.", 400);
  const source = SOURCES.find((s) => s === body.source) ?? "manual";
  try {
    const saved = await saveCounts(await getSupabase(), items, source);
    signalAfter("/api/inventory/counts");
    return Response.json({ saved });
  } catch (err) {
    return handleError(err);
  }
}
