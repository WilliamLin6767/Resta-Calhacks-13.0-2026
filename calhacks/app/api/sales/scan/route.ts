import { aiLimited } from "@/lib/inventory/http";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { readReceipt } from "@/lib/sales/ai";
import { checkReceipt } from "@/lib/sales/receipt";
import { loadMenu } from "@/lib/sales/service";
import { getSupabase } from "@/lib/supabase";

// POST /api/sales/scan   form field "file": a photo of a customer receipt
// Returns the receipt as read, with each line matched to a dish, for the owner to check. Nothing is saved.
export async function POST(request: Request) {
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size === 0) return errorResponse("Add a photo of the receipt.", 400);
  if (file.size > 15 * 1024 * 1024) return errorResponse("That photo is over 15 MB.", 400);
  const limited = aiLimited(request);
  if (limited) return limited;
  try {
    const menu = await loadMenu(await getSupabase());
    const receipt = await readReceipt(await file.arrayBuffer(), file.type, menu);
    return Response.json({ receipt, menu, notes: checkReceipt(receipt.lines, menu, receipt.subtotal || null) });
  } catch (err) {
    return handleError(err);
  }
}
