import { errorResponse, handleError } from "@/lib/purchasing/http";
import { saveReceipt } from "@/lib/sales/service";
import { getSupabase } from "@/lib/supabase";
import { signalAfter } from "@/lib/live/signal";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

// POST /api/sales/receipts   { receipt_number, date, time, channel, lines: [{ menu_item_id, qty, unit_price }], tax, tip, total }
// Adds a checked receipt to sales as an order. Returns how stock changed.
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  if (!DATE.test(b.date ?? "")) return errorResponse("The receipt needs a date.", 400);
  const lines = Array.isArray(b.lines)
    ? b.lines.slice(0, 100).map((l: Record<string, unknown>) => ({ menu_item_id: Number(l.menu_item_id), qty: Number(l.qty), unit_price: Number(l.unit_price) || 0 }))
    : [];
  try {
    const result = await saveReceipt(
      await getSupabase(),
      {
        receipt_number: typeof b.receipt_number === "string" ? b.receipt_number.slice(0, 40) : "",
        date: b.date,
        time: TIME.test(b.time ?? "") ? b.time : "12:00",
        channel: b.channel === "takeout" ? "takeout" : "dine_in",
        lines,
        tax: Number(b.tax) || 0,
        tip: Number(b.tip) || 0,
        total: Number(b.total) || 0,
      },
      b.source === "manual" ? "manual" : "photo",
    );
    signalAfter("/api/sales/receipts");
    return Response.json(result);
  } catch (err) {
    return handleError(err);
  }
}
