import { after } from "next/server";
import { scanForCalls } from "@/lib/calls/service";
import { readInvoice } from "@/lib/purchasing/ai";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { saveInvoiceOnce } from "@/lib/purchasing/service";
import { getSupabase } from "@/lib/supabase";
import { ROUTE_TOPICS } from "@/lib/live/routeTopics";
import { signalAfter, syncCalls } from "@/lib/live/signal";

const MAX_BYTES = 15 * 1024 * 1024;

// POST /api/invoices/scan   form data: file = a photo or PDF of a supplier invoice
// Claude reads it; we match each line to an ingredient, check it, save it, and
// record the new prices (so food cost and margins update). Returns { id }, or
// { id, duplicate: true } when the same invoice is already in the system (nothing is added twice).
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
    const saved = await saveInvoiceOnce(supabase, read, "photo");
    // Already in the system (often emailed first): nothing was added again, so there's nothing new to check
    if (saved.duplicate) return Response.json({ id: saved.id, duplicate: true, invoice_number: saved.invoice_number });
    const id = saved.id;
    // A new invoice can mean a billing error worth a call: look for calls after responding,
    // so the upload isn't slower. They only show up as pending requests to approve.
    after(() =>
      scanForCalls(supabase)
        .then((found) => syncCalls(supabase, found.created.map((c) => c.id), { topics: ROUTE_TOPICS["/api/calls/scan"] }))
        .catch((err) => console.error("Call scan after invoice failed:", err))
    );
    signalAfter("/api/invoices/scan");
    return Response.json({ id });
  } catch (err) {
    return handleError(err);
  }
}
