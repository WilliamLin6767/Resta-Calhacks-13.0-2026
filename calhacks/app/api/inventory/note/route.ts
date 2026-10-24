import { readNote } from "@/lib/inventory/ai";
import { aiLimited, toProposal } from "@/lib/inventory/http";
import { loadInventory } from "@/lib/inventory/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// POST /api/inventory/note   { "text": "40 pounds of bones, two cases of limes, tossed 3 lb sprouts" }
// Returns proposed counts and waste for the owner to check. Nothing is saved.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  if (!text) return errorResponse("Say or type what you counted or threw out.", 400);
  const limited = aiLimited(request);
  if (limited) return limited;
  try {
    const { refs, packQty } = await loadInventory(await getSupabase());
    const result = await readNote(text, refs);
    return Response.json({
      counts: result.counts.map((c) => toProposal(c, refs, packQty)),
      waste: result.waste.map((w) => ({ ...toProposal(w, refs, packQty), reason: w.reason })),
    });
  } catch (err) {
    return handleError(err);
  }
}
