// Invoice checks: find what's costing the restaurant money on one invoice.
// Pure logic (no database calls), so it's easy to test. The API route loads the
// data, calls checkInvoice(), and saves the flags to invoice_flags.

import { formatUnitCost } from "./units";

export const PRICE_UP_WARN = 0.05; // +5% vs last time from this supplier
export const PRICE_UP_HIGH = 0.15; // +15%: flag it loudly
export const CHEAPER_ELSEWHERE = 0.08; // another supplier is at least 8% cheaper
const SLACK = 0.02; // rounding slack, dollars

export type CheckInvoice = {
  id: number;
  supplier_id: number | null;
  invoice_number: string | null;
  invoice_date: string; // YYYY-MM-DD
  subtotal: number | null;
  tax: number | null;
  total: number | null;
};

export type CheckLine = {
  id: number;
  description: string;
  ingredient_id: number | null;
  ingredient_name: string | null;
  ingredient_unit: string | null;
  qty: number; // packs delivered and billed
  qty_ordered: number | null;
  pack_qty: number | null; // ingredient units per pack
  unit_price: number; // per pack
  printed_total: number | null;
  needs_review: boolean;
  match_source: string | null;
};

// A row from supplier_prices (plus the supplier's name)
export type PricePoint = {
  supplier_id: number;
  supplier: string;
  ingredient_id: number;
  pack_qty: number;
  price: number;
  effective_date: string;
};

export type Flag = {
  invoice_line_id: number | null;
  ingredient_id: number | null;
  kind: "price_up" | "price_down" | "math" | "total_mismatch" | "short" | "overcharge" | "duplicate" | "cheaper_elsewhere" | "unmatched" | "unit";
  severity: "high" | "medium" | "info";
  message: string;
  money_impact: number | null;
  alt_supplier_id?: number | null;
  alt_unit_price?: number | null;
};

const money = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD" });
const round2 = (x: number) => Math.round(x * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) <= SLACK + 0.005 * Math.abs(b);

export function checkInvoice(args: {
  invoice: CheckInvoice;
  lines: CheckLine[];
  prices: PricePoint[]; // supplier_prices for every ingredient on the invoice
  duplicateOf?: string | null; // invoice number of an earlier copy of this invoice, if any
  orderPrices?: Map<number, number>; // ingredient_id -> price per pack agreed on the purchase order
}): Flag[] {
  const { invoice, lines, prices, duplicateOf, orderPrices } = args;
  const flags: Flag[] = [];
  const add = (f: Flag) => flags.push({ ...f, money_impact: f.money_impact == null ? null : round2(f.money_impact) });

  if (duplicateOf) {
    add({ invoice_line_id: null, ingredient_id: null, kind: "duplicate", severity: "high",
      message: `Invoice #${invoice.invoice_number} was already entered. Don't pay it twice.`, money_impact: invoice.total });
  }

  let lineSum = 0;
  for (const l of lines) {
    const name = l.ingredient_name ?? l.description;
    const billed = l.printed_total ?? l.qty * l.unit_price;
    lineSum += billed;

    if (l.needs_review) {
      add({ invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "unmatched", severity: "info",
        message: l.match_source === "ai_new"
          ? `"${l.description}" looks like a new ingredient (${name}). Confirm it.`
          : `"${l.description}" isn't matched to an ingredient yet. Pick the right one.`,
        money_impact: null });
    }

    // Billed for packs that never arrived
    const ordered = l.qty_ordered ?? 0;
    const billedForOrdered = ordered > l.qty && l.printed_total != null && close(l.printed_total, ordered * l.unit_price);
    if (ordered > l.qty) {
      add(billedForOrdered
        ? { invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "short", severity: "high",
            message: `${name}: billed for ${ordered} but only ${l.qty} delivered.`, money_impact: (ordered - l.qty) * l.unit_price }
        : { invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "short", severity: "medium",
            message: `${name}: ordered ${ordered}, only ${l.qty} delivered.`, money_impact: null });
    }

    // Line math: qty x price should equal the printed total
    if (l.printed_total != null && !billedForOrdered && !close(l.printed_total, l.qty * l.unit_price)) {
      add({ invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "math", severity: "high",
        message: `${name}: ${l.qty} × ${money(l.unit_price)} = ${money(l.qty * l.unit_price)}, but the line says ${money(l.printed_total)}.`,
        money_impact: l.printed_total - l.qty * l.unit_price });
    }

    // Billed above the price on our purchase order
    const agreed = l.ingredient_id != null ? orderPrices?.get(l.ingredient_id) : undefined;
    if (agreed != null && l.unit_price > agreed * 1.01) {
      add({ invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "overcharge", severity: "high",
        message: `${name}: billed ${money(l.unit_price)} a pack, but the order said ${money(agreed)}.`,
        money_impact: (l.unit_price - agreed) * l.qty });
    }

    if (l.ingredient_id == null || !l.pack_qty || !l.ingredient_unit) continue;
    const unit = l.ingredient_unit;
    const cost = l.unit_price / l.pack_qty; // per ingredient unit
    const amount = l.qty * l.pack_qty; // ingredient units delivered
    const history = prices.filter((p) => p.ingredient_id === l.ingredient_id && p.pack_qty > 0);

    // Price change vs the last time this supplier charged us (before this invoice)
    const prev = history
      .filter((p) => p.supplier_id === invoice.supplier_id && p.effective_date < invoice.invoice_date)
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
    if (prev) {
      const prevCost = prev.price / prev.pack_qty;
      const change = cost / prevCost - 1;
      const extra = (cost - prevCost) * amount;
      const was = formatUnitCost(prevCost, unit), now = formatUnitCost(cost, unit);
      if (change >= PRICE_UP_WARN) {
        add({ invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "price_up",
          severity: change >= PRICE_UP_HIGH ? "high" : "medium",
          message: `${name} went up ${(change * 100).toFixed(0)}%: ${was} → ${now} (last price ${prev.effective_date}). That's ${money(extra)} more on this delivery.`,
          money_impact: extra });
      } else if (change <= -PRICE_UP_WARN) {
        add({ invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "price_down", severity: "info",
          message: `${name} dropped ${(-change * 100).toFixed(0)}%: ${was} → ${now}.`, money_impact: extra });
      }
    }

    // Someone else sells it cheaper (their latest price or quote)
    const latestBySupplier = new Map<number, PricePoint>();
    for (const p of history) {
      if (p.supplier_id === invoice.supplier_id) continue;
      const cur = latestBySupplier.get(p.supplier_id);
      if (!cur || p.effective_date > cur.effective_date) latestBySupplier.set(p.supplier_id, p);
    }
    const best = [...latestBySupplier.values()].sort((a, b) => a.price / a.pack_qty - b.price / b.pack_qty)[0];
    if (best && best.price / best.pack_qty <= cost * (1 - CHEAPER_ELSEWHERE)) {
      const bestCost = best.price / best.pack_qty;
      add({ invoice_line_id: l.id, ingredient_id: l.ingredient_id, kind: "cheaper_elsewhere", severity: "medium",
        message: `${name}: ${best.supplier} charges ${formatUnitCost(bestCost, unit)} (${((1 - bestCost / cost) * 100).toFixed(0)}% less, as of ${best.effective_date}). Buying there would have saved ${money((cost - bestCost) * amount)} on this delivery.`,
        money_impact: (cost - bestCost) * amount, alt_supplier_id: best.supplier_id, alt_unit_price: best.price });
    }
  }

  // Totals
  if (invoice.subtotal != null && !close(lineSum, invoice.subtotal) && Math.abs(lineSum - invoice.subtotal) > 0.1) {
    add({ invoice_line_id: null, ingredient_id: null, kind: "total_mismatch", severity: "high",
      message: `The lines add up to ${money(lineSum)}, but the subtotal says ${money(invoice.subtotal)}.`,
      money_impact: invoice.subtotal - lineSum });
  }
  if (invoice.subtotal != null && invoice.total != null && Math.abs(invoice.subtotal + (invoice.tax ?? 0) - invoice.total) > 0.1) {
    add({ invoice_line_id: null, ingredient_id: null, kind: "total_mismatch", severity: "high",
      message: `Subtotal ${money(invoice.subtotal)} + tax ${money(invoice.tax ?? 0)} doesn't equal the total ${money(invoice.total)}.`,
      money_impact: invoice.total - invoice.subtotal - (invoice.tax ?? 0) });
  }
  return flags;
}

// The dollars billed wrong (to dispute), as opposed to savings opportunities
export const BILLING_ERROR_KINDS = new Set(["math", "short", "overcharge", "duplicate", "total_mismatch"]);
