import { readShelfPhoto } from "@/lib/inventory/ai";
import { aiLimited, toProposal } from "@/lib/inventory/http";
import { loadInventory } from "@/lib/inventory/service";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// POST /api/inventory/photo   form field "file": a photo of a shelf or walk-in
// Returns proposed counts for the owner to check. Nothing is saved.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size === 0) return errorResponse("Add a photo.", 400);
  if (file.size > 15 * 1024 * 1024) return errorResponse("That photo is over 15 MB.", 400);
  const limited = aiLimited(request);
  if (limited) return limited;
  try {
    const { refs, packQty } = await loadInventory(await getSupabase());
    const result = await readShelfPhoto(await file.arrayBuffer(), file.type, refs);
    return Response.json({ items: result.items.map((i) => toProposal(i, refs, packQty)), notes: result.notes });
  } catch (err) {
    return handleError(err);
  }
}
