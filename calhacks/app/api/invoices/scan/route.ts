import { readInvoice } from "@/lib/purchasing/ai";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { saveScannedInvoice } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";

const MAX_BYTES = 15 * 1024 * 1024;

// POST /api/invoices/scan   form data: file = a photo or PDF of a supplier invoice
// Claude reads it; we match each line to an ingredient, check it, save it, and
// record the new prices (so food cost and margins update). Returns { id }.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorResponse("Attach the invoice as a file named 'file'.", 400);
  if (file.size > MAX_BYTES) return errorResponse("That file is too big (15 MB max).", 413);
  const mediaType = file.type === "image/jpg" ? "image/jpeg" : file.type;

  try {
    const read = await readInvoice(await file.arrayBuffer(), mediaType);
    if (!read.lines.length) return errorResponse("No product lines found. Is this a supplier invoice?", 422);
    const supabase = await getSupabase();
    const id = await saveScannedInvoice(supabase, read, "photo");
    return Response.json({ id });
  } catch (err) {
    return handleError(err);
  }
}
