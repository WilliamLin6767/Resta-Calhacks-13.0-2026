// Which supplier calls might be worth making. Plain rules over data passed in
// (no database calls), so they can be tested on fixtures. Claude only judges
// the candidates afterwards (lib/calls/ai.ts).
//
//   dispute  unresolved billing flags on an invoice worth $5 or more
//            (without invoice_flags: a matched line priced over 5% above
//            that supplier's last earlier price)
//   buy      below reorder point, preferred supplier takes phone orders
//   info     a price up more than 10% in 30 days, or below reorder point with
//            a supplier that doesn't take phone orders
//
// Special requests come only from the owner, never from here.

import { nextDeliveryDate } from "@/lib/purchasing/orders";
import { normalizePhone } from "./phone";
import { OPEN_STATUSES, type BriefRefs, type CallPurpose, type CallStatus, type ContextType } from "./types";

export const DISPUTE_KINDS = new Set(["overcharge", "price_up", "short", "duplicate", "math", "total_mismatch"]);
export const MIN_DISPUTE = 5; // dollars
const FALLBACK_RISE = 0.05; // invoice line over last price, when there are no flags
const INFO_RISE = 0.1; // price rise over 30 days worth asking about
const REJECTED_COOLDOWN_DAYS = 7;
const BUY_TOTAL_HEADROOM = 1.1; // allow 10% over the last price when ordering

export type FactSupplier = {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  preferred_channel: string | null;
  lead_time_days: number | null;
  delivery_days: string | null;
};
export type FactIngredient = {
  id: number;
  name: string;
  unit: string;
  current_qty: number;
  reorder_point: number | null;
  par_level: number | null;
  preferred_supplier_id: number | null;
};
export type FactPrice = {
  supplier_id: number;
  ingredient_id: number;
  pack_qty: number;
  pack_desc: string | null;
  price: number;
  effective_date: string;
};
export type FactFlag = {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  invoice_date: string;
  supplier_id: number | null;
  kind: string;
  message: string;
  money_impact: number | null;
  line: { description: string; qty: number; unit_price: number } | null;
};
export type FactInvoiceLine = {
  invoice_id: number;
  invoice_number: string | null;
  invoice_date: string;
  supplier_id: number | null;
  ingredient_id: number | null;
  description: string;
  qty: number;
  unit_price: number;
};
export type FactDraftOrder = { id: number; supplier_id: number | null; lines: { ingredient_id: number; qty: number }[] };
export type FactExisting = { context_type: ContextType; context_id: number; status: CallStatus; created_at: string };

export type Facts = {
  today: string; // YYYY-MM-DD
  suppliers: FactSupplier[];
  ingredients: FactIngredient[];
  prices: FactPrice[];
  flags: FactFlag[] | null; // null when the invoice_flags table doesn't exist
  invoiceLines: FactInvoiceLine[]; // only used when flags is null
  draftOrders: FactDraftOrder[];
  existing: FactExisting[];
};

// Limits set by our code from the data. Claude can't change them; the owner can.
export type CandidateLimits = { min_credit: number; max_packs: number; max_total: number };

export type Candidate = {
  purpose: Exclude<CallPurpose, "special_request">;
  supplier_id: number;
  supplier_name: string;
  contact_name: string | null; // who to ask for, when known
  context_type: ContextType;
  context_id: number;
  summary: string; // one line, for logs and the no-phone list
  facts: Record<string, unknown>; // what Claude reads to judge and write the brief
  limits: CandidateLimits;
  wanted_by: string;
  refs: BriefRefs;
};

export type NoPhone = { supplier_id: number; supplier_name: string; purpose: Candidate["purpose"]; summary: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The latest price on or before `date` (or overall), for one supplier and ingredient.
export function latestPrice(prices: FactPrice[], supplierId: number, ingredientId: number, before?: string): FactPrice | null {
  let best: FactPrice | null = null;
  for (const p of prices) {
    if (p.supplier_id !== supplierId || p.ingredient_id !== ingredientId) continue;
    if (before !== undefined && p.effective_date >= before) continue;
    if (!best || p.effective_date > best.effective_date) best = p;
  }
  return best;
}

const unitCost = (p: FactPrice) => p.price / p.pack_qty;

// ---------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------

function disputes(f: Facts, supplierOf: Map<number, FactSupplier>): Candidate[] {
  type Item = { flag_id?: number; kind: string; message: string; money_impact: number; line: FactFlag["line"] };
  const byInvoice = new Map<number, { head: Pick<FactFlag, "invoice_id" | "invoice_number" | "invoice_date" | "supplier_id">; items: Item[] }>();
  const add = (head: Pick<FactFlag, "invoice_id" | "invoice_number" | "invoice_date" | "supplier_id">, item: Item) => {
    const entry = byInvoice.get(head.invoice_id) ?? { head, items: [] };
    entry.items.push(item);
    byInvoice.set(head.invoice_id, entry);
  };

  if (f.flags) {
    for (const flag of f.flags) {
      if (!DISPUTE_KINDS.has(flag.kind) || (flag.money_impact ?? 0) < MIN_DISPUTE) continue;
      add(flag, { flag_id: flag.id, kind: flag.kind, message: flag.message, money_impact: flag.money_impact!, line: flag.line });
    }
  } else {
    // No invoice_flags table: compare each matched line with the supplier's last earlier price.
    for (const line of f.invoiceLines) {
      if (line.supplier_id === null || line.ingredient_id === null) continue;
      const prev = latestPrice(f.prices, line.supplier_id, line.ingredient_id, line.invoice_date);
      if (!prev || prev.price <= 0 || line.unit_price <= prev.price * (1 + FALLBACK_RISE)) continue;
      const impact = round2((line.unit_price - prev.price) * line.qty);
      if (impact < MIN_DISPUTE) continue;
      const pct = Math.round((line.unit_price / prev.price - 1) * 100);
      add(line, {
        kind: "price_up",
        message: `${line.description}: charged $${line.unit_price.toFixed(2)} a pack, last price was $${prev.price.toFixed(2)} on ${prev.effective_date} (+${pct}%).`,
        money_impact: impact,
        line: { description: line.description, qty: line.qty, unit_price: line.unit_price },
      });
    }
  }

  const out: Candidate[] = [];
  for (const { head, items } of byInvoice.values()) {
    const supplier = head.supplier_id !== null ? supplierOf.get(head.supplier_id) : undefined;
    if (!supplier) continue;
    const total = round2(items.reduce((s, i) => s + i.money_impact, 0));
    const label = head.invoice_number ?? `#${head.invoice_id}`;
    out.push({
      purpose: "dispute",
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      contact_name: supplier.contact_name,
      context_type: "invoice",
      context_id: head.invoice_id,
      summary: `Dispute $${total.toFixed(2)} on invoice ${label} from ${supplier.name}`,
      facts: {
        invoice_number: label,
        invoice_date: head.invoice_date,
        problems: items.map((i) => ({ kind: i.kind, message: i.message, dollars: i.money_impact, line: i.line })),
        total_at_stake: total,
      },
      limits: { min_credit: total, max_packs: 0, max_total: 0 },
      wanted_by: "",
      refs: { invoice_id: head.invoice_id, flag_ids: items.flatMap((i) => (i.flag_id !== undefined ? [i.flag_id] : [])) },
    });
  }
  return out;
}

function belowReorder(i: FactIngredient) {
  return i.reorder_point !== null && i.current_qty < i.reorder_point;
}

function buys(f: Facts, supplierOf: Map<number, FactSupplier>): Candidate[] {
  type Item = { ingredient: FactIngredient; packs: number | null; price: FactPrice | null; needed: number };
  const groups = new Map<string, { supplier: FactSupplier; order: FactDraftOrder | null; items: Item[] }>();

  for (const ing of f.ingredients) {
    if (!belowReorder(ing) || ing.preferred_supplier_id === null) continue;
    const supplier = supplierOf.get(ing.preferred_supplier_id);
    if (!supplier || supplier.preferred_channel !== "phone") continue;
    const needed = round2((ing.par_level ?? ing.reorder_point!) - ing.current_qty);
    if (needed <= 0) continue;
    const price = latestPrice(f.prices, supplier.id, ing.id);
    const packs = price ? Math.ceil(needed / price.pack_qty) : null;
    // A draft order to this supplier that already has this ingredient: call about that order instead.
    const order = f.draftOrders.find((o) => o.supplier_id === supplier.id && o.lines.some((l) => l.ingredient_id === ing.id)) ?? null;
    const key = order ? `po:${order.id}` : `ing:${ing.id}`;
    const group = groups.get(key) ?? { supplier, order, items: [] };
    group.items.push({ ingredient: ing, packs, price, needed });
    groups.set(key, group);
  }

  const out: Candidate[] = [];
  for (const { supplier, order, items } of groups.values()) {
    const maxPacks = items.reduce((s, i) => s + (i.packs ?? 0), 0);
    const estimate = round2(items.reduce((s, i) => s + (i.packs !== null && i.price ? i.packs * i.price.price : 0), 0));
    const names = items.map((i) => i.ingredient.name).join(", ");
    out.push({
      purpose: "buy",
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      contact_name: supplier.contact_name,
      context_type: order ? "purchase_order" : "ingredient",
      context_id: order ? order.id : items[0].ingredient.id,
      summary: `Order ${names} from ${supplier.name}`,
      facts: {
        purchase_order_id: order?.id ?? null,
        items: items.map((i) => ({
          ingredient: i.ingredient.name,
          on_hand: `${i.ingredient.current_qty} ${i.ingredient.unit}`,
          reorder_point: i.ingredient.reorder_point,
          par_level: i.ingredient.par_level,
          needed: `${i.needed} ${i.ingredient.unit}`,
          packs: i.packs,
          pack: i.price?.pack_desc ?? (i.price ? `${i.price.pack_qty} ${i.ingredient.unit}` : null),
          last_price_per_pack: i.price?.price ?? null,
          last_price_date: i.price?.effective_date ?? null,
        })),
        estimated_total: estimate,
      },
      limits: { min_credit: 0, max_packs: maxPacks, max_total: estimate > 0 ? round2(estimate * BUY_TOTAL_HEADROOM) : 0 },
      wanted_by: nextDeliveryDate(f.today, supplier),
      refs: {
        ingredient_ids: items.map((i) => i.ingredient.id),
        ...(items.length === 1 ? { ingredient_id: items[0].ingredient.id } : {}),
        ...(order ? { purchase_order_id: order.id } : {}),
      },
    });
  }
  return out;
}

function infos(f: Facts, supplierOf: Map<number, FactSupplier>): Candidate[] {
  const out: Candidate[] = [];
  const monthAgo = addDays(f.today, -30);
  for (const ing of f.ingredients) {
    if (ing.preferred_supplier_id === null) continue;
    const supplier = supplierOf.get(ing.preferred_supplier_id);
    if (!supplier) continue;

    // 1. The latest price rose more than 10% (per unit) over the last 30 days.
    const latest = latestPrice(f.prices, supplier.id, ing.id);
    const before = latestPrice(f.prices, supplier.id, ing.id, monthAgo);
    const rise = latest && before && latest.effective_date >= monthAgo ? unitCost(latest) / unitCost(before) - 1 : 0;
    // 2. Running low, but this supplier doesn't take phone orders.
    const lowNoPhoneOrders = belowReorder(ing) && supplier.preferred_channel !== "phone";
    if (rise <= INFO_RISE && !lowNoPhoneOrders) continue;

    const reasons: string[] = [];
    if (rise > INFO_RISE) {
      reasons.push(
        `${ing.name} went from $${before!.price.toFixed(2)} (${before!.effective_date}) to $${latest!.price.toFixed(2)} a pack (${latest!.effective_date}), up ${Math.round(rise * 100)}%.`
      );
    }
    if (lowNoPhoneOrders) reasons.push(`${ing.name} is below its reorder point (${ing.current_qty} ${ing.unit} on hand, reorder at ${ing.reorder_point}).`);
    out.push({
      purpose: "info",
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      contact_name: supplier.contact_name,
      context_type: "ingredient",
      context_id: ing.id,
      summary: `Ask ${supplier.name} about ${ing.name}`,
      facts: {
        ingredient: ing.name,
        why: reasons,
        suggested_topics: [
          ...(rise > INFO_RISE ? ["why the price went up", "whether it will come down, and what the price will be next month"] : []),
          ...(lowNoPhoneOrders ? ["whether there's a shortage", "when they can deliver next"] : []),
        ],
      },
      limits: { min_credit: 0, max_packs: 0, max_total: 0 },
      wanted_by: "",
      refs: { ingredient_id: ing.id },
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Dedupe and the full run
// ---------------------------------------------------------------------

// Skip a record that already has an open request, or one rejected in the last 7 days.
export function isBlocked(existing: FactExisting[], contextType: ContextType, contextId: number, today: string): boolean {
  const cutoff = addDays(today, -REJECTED_COOLDOWN_DAYS);
  return existing.some(
    (e) =>
      e.context_type === contextType &&
      e.context_id === contextId &&
      (OPEN_STATUSES.includes(e.status) || (e.status === "rejected" && e.created_at.slice(0, 10) >= cutoff))
  );
}

export function findCandidates(f: Facts): { candidates: Candidate[]; noPhone: NoPhone[] } {
  const supplierOf = new Map(f.suppliers.map((s) => [s.id, s]));
  // Order matters: on the same record, a dispute or an order wins over a question.
  const all = [...disputes(f, supplierOf), ...buys(f, supplierOf), ...infos(f, supplierOf)];

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const noPhone: NoPhone[] = [];
  for (const c of all) {
    const key = `${c.context_type}:${c.context_id}`;
    if (seen.has(key) || isBlocked(f.existing, c.context_type, c.context_id, f.today)) continue;
    seen.add(key);
    if (!normalizePhone(supplierOf.get(c.supplier_id)?.phone)) {
      noPhone.push({ supplier_id: c.supplier_id, supplier_name: c.supplier_name, purpose: c.purpose, summary: c.summary });
      continue;
    }
    candidates.push(c);
  }
  return { candidates, noPhone };
}
