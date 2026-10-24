import { loadLedger } from "@/lib/accounting/service";
import { quickbooksCsv } from "@/lib/accounting/reconcile";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/accounting/quickbooks?from=2026-09-01&to=2026-09-30
// A CSV of payouts received and bills paid, in QuickBooks Online's 3-column bank-transaction format.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to) || from > to) return errorResponse("Pick a start and end date.", 400);
  try {
    const csv = quickbooksCsv(await loadLedger(await getSupabase(), from, to));
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="quickbooks-${from}-to-${to}.csv"` },
    });
  } catch (err) {
    return handleError(err);
  }
}
