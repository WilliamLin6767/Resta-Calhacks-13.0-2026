// Purchasing workflow on top of Supabase (server only).
//   saveScannedInvoice - a freshly read invoice -> match, check, save, record new prices
//   recheckInvoice     - re-run matching (incl. AI for unmatched lines) and checks on a saved invoice
//   confirmLine        - a person says what a line is; remembered for next time
//   orderFromFlag      - turn a "cheaper elsewhere" flag into a draft purchase order
//   loadOrders         - open purchase orders, with the message to send each supplier
//   setOrderStatus     - approve, send, receive or cancel an order
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";
import { matchLines, type ReadInvoice } from "./ai";
import { checkInvoice, type CheckLine, type PricePoint } from "./checks";
import { CONFIDENT, matchLine, normalize, tokenSetRatio, type Alias, type Ingredient } from "./matching";
import { belowMinimum, contactLink, NEXT_STATUS, nextDeliveryDate, orderMessage, orderTotal, type OrderLine, type OrderSupplier } from "./orders";
import { packQtyIn, parsePack } from "./units";

type Db = SupabaseClient;

// Row shapes for the queries below (numeric columns arrive as numbers)
type InvoiceRow = {
  id: number; supplier_id: number | null; invoice_number: string | null; invoice_date: string;
  subtotal: number | null; tax: number | null; total: number | null; purchase_order_id: number | null;
};
type LineRow = {
  id: number; description: string; ingredient_id: number | null; qty: number; qty_ordered: number | null;
  pack_qty: number | null; unit_price: number; printed_total: number | null; needs_review: boolean;
  match_source: string | null; ingredients: { name: string; unit: string } | null;
};
type PriceRow = {
  supplier_id: number; ingredient_id: number; pack_qty: number; price: number; effective_date: string;
  suppliers: { name: string } | null;
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

async function loadIngredients(db: Db): Promise<Ingredient[]> {
  return must(await db.from("ingredients").select("id, name, unit").eq("restaurant_id", RESTAURANT_ID), "load ingredients");
}

// Learned matches: confirmed aliases plus every invoice line already matched to an ingredient.
async function loadAliases(db: Db): Promise<Alias[]> {
  const saved = must(
    await db.from("ingredient_aliases").select("alias, ingredient_id, supplier_id").eq("restaurant_id", RESTAURANT_ID),
    "load learned matches",
  ) as Alias[];
  const matched = must(
    await db.from("invoice_lines").select("description, ingredient_id, invoices!inner(supplier_id, restaurant_id)")
      .not("ingredient_id", "is", null).eq("needs_review", false).eq("invoices.restaurant_id", RESTAURANT_ID),
    "load matched invoice lines",
  ) as unknown as { description: string; ingredient_id: number; invoices: { supplier_id: number | null } }[];
  return [
    ...saved,
    ...matched.map((m) => ({ alias: normalize(m.description), ingredient_id: m.ingredient_id, supplier_id: m.invoices.supplier_id })),
  ];
}

async function findOrCreateSupplier(db: Db, printed: string): Promise<number | null> {
  if (!printed.trim()) return null;
  const suppliers = must(await db.from("suppliers").select("id, name").eq("restaurant_id", RESTAURANT_ID), "load suppliers") as { id: number; name: string }[];
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\b(INC|LLC|CO|CORP|COMPANY)\b/g, " ").replace(/\s+/g, " ").trim();
  const best = suppliers.map((s) => ({ s, score: tokenSetRatio(clean(printed), clean(s.name)) })).sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 0.85) return best.s.id;
  const created = must(await db.from("suppliers").insert({ restaurant_id: RESTAURANT_ID, name: printed.trim() }).select("id").single(), "add the supplier") as { id: number };
  return created.id;
}

async function findOrCreateIngredient(db: Db, name: string, category: string, unit: string): Promise<number> {
  const existing = must(await db.from("ingredients").select("id").eq("restaurant_id", RESTAURANT_ID).ilike("name", name).maybeSingle(), "look up the ingredient") as { id: number } | null;
  if (existing) return existing.id;
  const created = must(await db.from("ingredients").insert({ restaurant_id: RESTAURANT_ID, name, category, unit, current_qty: 0 }).select("id").single(), "add the ingredient") as { id: number };
  return created.id;
}

// Ingredient units per pack, from the pack size printed on the line.
// If the line is sold by weight (sold_by LB), one "pack" is one of that unit.
function packQty(desc: string, pack: string, soldBy: string, unit: string): number | null {
  const by = soldBy.trim().toUpperCase();
  if (["LB", "LBS", "OZ", "KG", "EA", "CT", "DZ", "BU", "BUNCH", "HEAD", "CAN"].includes(by)) {
    const one = packQtyIn(parsePack(`1 ${by}`), unit);
    if (one) return one;
  }
  return packQtyIn(parsePack(pack) ?? parsePack(desc), unit);
}

type MatchedLine = {
  description: string; item_code: string; pack_desc: string; sold_by: string;
  qty: number; qty_ordered: number | null; unit_price: number; printed_total: number | null;
  ingredient_id: number | null; match_score: number; match_source: string | null; needs_review: boolean; norm: string;
};

// Learned -> fuzzy -> Claude for the rest. New ingredients are added but flagged for review.
async function matchAll(db: Db, supplierId: number | null, lines: Omit<MatchedLine, "ingredient_id" | "match_score" | "match_source" | "needs_review" | "norm">[]) {
  const ingredients = await loadIngredients(db);
  const aliases = await loadAliases(db);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const out: MatchedLine[] = lines.map((l) => {
    const m = matchLine(l.description, supplierId, ingredients, aliases);
    return { ...l, ingredient_id: m.ingredient_id, match_score: m.score, match_source: m.source, needs_review: false, norm: m.norm };
  });
  const unsure = out
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.ingredient_id == null || l.match_score < CONFIDENT);
  if (unsure.length) {
    const answers = await matchLines(unsure.map(({ l, i }) => ({
      line: i, description: l.description, pack: l.pack_desc,
      candidates: matchLine(l.description, supplierId, ingredients, aliases).candidates
        .map((c) => ({ ingredient_id: c.ingredient_id, name: byId.get(c.ingredient_id)?.name ?? "" })),
    })));
    for (const { l, i } of unsure) {
      const a = answers.get(i);
      if (!a) continue;
      if (byId.has(a.ingredient_id)) {
        Object.assign(l, { ingredient_id: a.ingredient_id, match_score: a.confidence, match_source: "ai" });
      } else if (a.ingredient_id === 0 && a.new_ingredient_name) {
        const id = await findOrCreateIngredient(db, a.new_ingredient_name, a.new_ingredient_category || "other", a.new_ingredient_unit);
        Object.assign(l, { ingredient_id: id, match_score: Math.min(a.confidence, 0.8), match_source: "ai_new" });
      }
    }
  }
  for (const l of out) {
    l.needs_review = l.ingredient_id == null || l.match_score < CONFIDENT || l.match_source === "ai_new";
  }
  return out;
}

// ---------- Checks ----------

export async function runChecks(db: Db, invoiceId: number) {
  const inv = must(await db.from("invoices").select("*").eq("id", invoiceId).single(), "load the invoice") as InvoiceRow;
  const lines = must(
    await db.from("invoice_lines").select("*, ingredients(name, unit)").eq("invoice_id", invoiceId).order("id"),
    "load the invoice lines",
  ) as LineRow[];
  const ingredientIds = [...new Set(lines.map((l) => l.ingredient_id).filter(Boolean))];
  const prices = ingredientIds.length
    ? (must(await db.from("supplier_prices").select("supplier_id, ingredient_id, pack_qty, price, effective_date, suppliers(name)").in("ingredient_id", ingredientIds), "load price history") as unknown as PriceRow[])
    : [];
  const dup = inv.invoice_number
    ? (must(await db.from("invoices").select("id").eq("restaurant_id", RESTAURANT_ID).eq("supplier_id", inv.supplier_id).eq("invoice_number", inv.invoice_number).neq("id", invoiceId).limit(1), "check for duplicates") as unknown[])
    : [];
  const orderPrices = new Map<number, number>();
  if (inv.purchase_order_id) {
    const ol = must(await db.from("purchase_order_lines").select("ingredient_id, est_unit_price").eq("purchase_order_id", inv.purchase_order_id), "load the purchase order") as { ingredient_id: number; est_unit_price: number | null }[];
    for (const o of ol) if (o.est_unit_price != null) orderPrices.set(o.ingredient_id, Number(o.est_unit_price));
  }

  const flags = checkInvoice({
    invoice: { id: inv.id, supplier_id: inv.supplier_id, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date,
      subtotal: inv.subtotal == null ? null : Number(inv.subtotal), tax: inv.tax == null ? null : Number(inv.tax),
      total: inv.total == null ? null : Number(inv.total) },
    lines: lines.map((l): CheckLine => ({
      id: l.id, description: l.description, ingredient_id: l.ingredient_id, ingredient_name: l.ingredients?.name ?? null,
      ingredient_unit: l.ingredients?.unit ?? null, qty: Number(l.qty), qty_ordered: l.qty_ordered == null ? null : Number(l.qty_ordered),
      pack_qty: l.pack_qty == null ? null : Number(l.pack_qty), unit_price: Number(l.unit_price),
      printed_total: l.printed_total == null ? null : Number(l.printed_total), needs_review: !!l.needs_review, match_source: l.match_source,
    })),
    prices: prices.map((p): PricePoint => ({ supplier_id: p.supplier_id, supplier: p.suppliers?.name ?? "Another supplier",
      ingredient_id: p.ingredient_id, pack_qty: Number(p.pack_qty), price: Number(p.price), effective_date: p.effective_date })),
    duplicateOf: dup.length ? inv.invoice_number : null,
    orderPrices,
  });

  must(await db.from("invoice_flags").delete().eq("invoice_id", invoiceId), "clear old flags");
  if (flags.length) must(await db.from("invoice_flags").insert(flags.map((f) => ({ ...f, invoice_id: invoiceId }))), "save the flags");
  return flags;
}

// ---------- Saving a scanned invoice ----------

export async function saveScannedInvoice(db: Db, read: ReadInvoice, source: "photo" | "email" | "manual" = "photo") {
  const supplierId = await findOrCreateSupplier(db, read.supplier_name);
  const raw = read.lines
    .filter((l) => l.description.trim() && (l.qty_shipped || l.qty_ordered))
    .map((l) => ({
      description: l.description.trim(), item_code: l.item_code, pack_desc: l.pack, sold_by: l.sold_by || "CS",
      qty: l.qty_shipped || l.qty_ordered, qty_ordered: l.qty_ordered || null, unit_price: l.unit_price,
      printed_total: l.line_total || null,
    }));
  const lines = await matchAll(db, supplierId, raw);
  const ingredients = new Map((await loadIngredients(db)).map((i) => [i.id, i]));

  // The delivery fills the most recent open (sent) purchase order from this supplier, if any
  let purchaseOrderId: number | null = null;
  if (supplierId) {
    const po = must(await db.from("purchase_orders").select("id").eq("restaurant_id", RESTAURANT_ID).eq("supplier_id", supplierId)
      .eq("status", "sent").order("created_at", { ascending: false }).limit(1), "look for an open order") as { id: number }[];
    purchaseOrderId = po[0]?.id ?? null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const invoice = must(await db.from("invoices").insert({
    restaurant_id: RESTAURANT_ID, supplier_id: supplierId, invoice_number: read.invoice_number || null,
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(read.invoice_date) ? read.invoice_date : today,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(read.due_date) ? read.due_date : null,
    total: read.total || null, subtotal: read.subtotal || null, tax: read.tax || 0,
    status: "received", source, notes: read.notes || null, purchase_order_id: purchaseOrderId,
  }).select("id, invoice_date").single(), "save the invoice") as { id: number; invoice_date: string };

  const rows = lines.map((l) => {
    const ing = l.ingredient_id ? ingredients.get(l.ingredient_id) : undefined;
    return {
      invoice_id: invoice.id, ingredient_id: l.ingredient_id, description: l.description, qty: l.qty,
      pack_qty: ing ? packQty(l.description, l.pack_desc, l.sold_by, ing.unit) : null, unit_price: l.unit_price,
      item_code: l.item_code || null, pack_desc: l.pack_desc || null, sold_by: l.sold_by, qty_ordered: l.qty_ordered,
      printed_total: l.printed_total, match_score: Math.round(l.match_score * 1000) / 1000, match_source: l.match_source,
      needs_review: l.needs_review,
    };
  });
  must(await db.from("invoice_lines").insert(rows), "save the invoice lines");
  if (purchaseOrderId) await db.from("purchase_orders").update({ status: "received" }).eq("id", purchaseOrderId);

  // Remember confident automatic matches so the next invoice is instant
  const learned = lines.filter((l) => l.ingredient_id && !l.needs_review && (l.match_source === "fuzzy" || l.match_source === "ai"))
    .map((l) => ({ restaurant_id: RESTAURANT_ID, supplier_id: supplierId, alias: l.norm, ingredient_id: l.ingredient_id, source: "auto" }));
  if (learned.length) await db.from("ingredient_aliases").upsert(learned, { onConflict: "restaurant_id,supplier_id,alias", ignoreDuplicates: true });

  // Check against the price history BEFORE adding this invoice's prices to it
  await runChecks(db, invoice.id);
  await recordPrices(db, invoice.id);
  return invoice.id;
}

// Add this invoice's confident lines to supplier_prices, so food cost and margins update.
async function recordPrices(db: Db, invoiceId: number, onlyLineId?: number) {
  const inv = must(await db.from("invoices").select("supplier_id, invoice_date").eq("id", invoiceId).single(), "load the invoice") as { supplier_id: number | null; invoice_date: string };
  if (!inv.supplier_id) return;
  let q = db.from("invoice_lines").select("id, ingredient_id, pack_qty, pack_desc, unit_price").eq("invoice_id", invoiceId)
    .eq("needs_review", false).not("ingredient_id", "is", null).not("pack_qty", "is", null);
  if (onlyLineId) q = q.eq("id", onlyLineId);
  const lines = must(await q, "load lines to price") as { ingredient_id: number; pack_qty: number; pack_desc: string | null; unit_price: number }[];
  const rows = lines.filter((l) => Number(l.pack_qty) > 0).map((l) => ({
    supplier_id: inv.supplier_id, ingredient_id: l.ingredient_id, pack_desc: l.pack_desc, pack_qty: l.pack_qty,
    price: l.unit_price, effective_date: inv.invoice_date, source: "invoice",
  }));
  if (rows.length) must(await db.from("supplier_prices").insert(rows), "record the new prices");
}

// ---------- Re-checking an invoice already in the database ----------

export async function recheckInvoice(db: Db, invoiceId: number) {
  const inv = must(await db.from("invoices").select("supplier_id").eq("id", invoiceId).single(), "load the invoice") as { supplier_id: number | null };
  const open = must(await db.from("invoice_lines").select("id, description, pack_desc, sold_by").eq("invoice_id", invoiceId).is("ingredient_id", null), "load unmatched lines") as { id: number; description: string; pack_desc: string | null; sold_by: string | null }[];
  if (open.length) {
    const matched = await matchAll(db, inv.supplier_id, open.map((l) => ({
      description: l.description, item_code: "", pack_desc: l.pack_desc ?? "", sold_by: l.sold_by ?? "CS",
      qty: 0, qty_ordered: null, unit_price: 0, printed_total: null,
    })));
    const ingredients = new Map((await loadIngredients(db)).map((i) => [i.id, i]));
    for (let i = 0; i < open.length; i++) {
      const m = matched[i];
      const ing = m.ingredient_id ? ingredients.get(m.ingredient_id) : undefined;
      const update: Record<string, unknown> = { ingredient_id: m.ingredient_id, match_score: Math.round(m.match_score * 1000) / 1000, match_source: m.match_source, needs_review: m.needs_review };
      if (ing) update.pack_qty = packQty(m.description, m.pack_desc, m.sold_by, ing.unit) ?? undefined;
      must(await db.from("invoice_lines").update(update).eq("id", open[i].id), "save the match");
    }
  }
  return runChecks(db, invoiceId);
}

// ---------- A person confirms a match ----------

export async function confirmLine(db: Db, lineId: number, choice: { ingredient_id?: number; new_ingredient_name?: string; new_ingredient_unit?: string }) {
  const line = must(await db.from("invoice_lines").select("id, invoice_id, description, pack_desc, sold_by, invoices(supplier_id)").eq("id", lineId).single(), "load the line") as {
    id: number; invoice_id: number; description: string; pack_desc: string | null; sold_by: string | null; invoices: { supplier_id: number | null } | null;
  };
  let ingredientId = choice.ingredient_id;
  if (!ingredientId && choice.new_ingredient_name) {
    ingredientId = await findOrCreateIngredient(db, choice.new_ingredient_name.trim(), "other", choice.new_ingredient_unit || "ea");
  }
  if (!ingredientId) throw new Error("Pick an ingredient or type a new one");
  const ing = must(await db.from("ingredients").select("unit").eq("id", ingredientId).single(), "load the ingredient") as { unit: string };
  must(await db.from("invoice_lines").update({
    ingredient_id: ingredientId, match_score: 1, match_source: "manual", needs_review: false,
    pack_qty: packQty(line.description, line.pack_desc ?? "", line.sold_by ?? "CS", ing.unit),
  }).eq("id", lineId), "save the match");
  await db.from("ingredient_aliases").upsert(
    { restaurant_id: RESTAURANT_ID, supplier_id: line.invoices?.supplier_id ?? null, alias: normalize(line.description), ingredient_id: ingredientId, source: "confirmed" },
    { onConflict: "restaurant_id,supplier_id,alias" },
  );
  await runChecks(db, line.invoice_id);
  await recordPrices(db, line.invoice_id, lineId);
  return line.invoice_id;
}

// ---------- "Cheaper elsewhere" -> a draft purchase order ----------

export async function orderFromFlag(db: Db, flagId: number) {
  const flag = must(await db.from("invoice_flags").select("*, invoice_lines(qty, pack_qty)").eq("id", flagId).single(), "load the flag") as {
    kind: string; message: string; ingredient_id: number | null; alt_supplier_id: number | null;
    invoice_lines: { qty: number; pack_qty: number | null } | null;
  };
  if (flag.kind !== "cheaper_elsewhere" || !flag.alt_supplier_id) throw new Error("Only a cheaper-supplier flag can become an order");
  const alt = must(await db.from("supplier_prices").select("pack_qty, price").eq("supplier_id", flag.alt_supplier_id).eq("ingredient_id", flag.ingredient_id)
    .order("effective_date", { ascending: false }).limit(1), "load the other supplier's price") as { pack_qty: number; price: number }[];
  if (!alt.length) throw new Error("That supplier has no price on file");
  const needed = Number(flag.invoice_lines?.qty ?? 1) * Number(flag.invoice_lines?.pack_qty ?? alt[0].pack_qty);
  const packs = Math.max(1, Math.ceil(needed / Number(alt[0].pack_qty)));
  const po = must(await db.from("purchase_orders").insert({
    restaurant_id: RESTAURANT_ID, supplier_id: flag.alt_supplier_id, status: "draft", created_by: "ai", reason: flag.message,
  }).select("id").single(), "create the order") as { id: number };
  must(await db.from("purchase_order_lines").insert({ purchase_order_id: po.id, ingredient_id: flag.ingredient_id, qty: packs, est_unit_price: alt[0].price }), "add the order line");
  await db.from("invoice_flags").update({ resolved: true }).eq("id", flagId);
  return po.id;
}

// ---------- Purchase orders waiting on the owner ----------

export type OpenOrder = {
  id: number; status: string; created_by: string; reason: string | null; created_at: string;
  supplier: string; lines: OrderLine[]; total: number; below_minimum: number; min_order_amount: number;
  delivery_date: string; message: string; contact: { label: string; href: string | null };
};

export async function loadOrders(db: Db): Promise<OpenOrder[]> {
  const [orders, restaurant] = await Promise.all([
    db.from("purchase_orders")
      .select("id, status, created_by, reason, created_at, expected_date, supplier_id, suppliers(name, contact_name, phone, email, preferred_channel, lead_time_days, min_order_amount, delivery_days), purchase_order_lines(ingredient_id, qty, est_unit_price, ingredients(name))")
      .eq("restaurant_id", RESTAURANT_ID)
      .in("status", ["draft", "approved", "sent"])
      .order("created_at", { ascending: false }),
    db.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle(),
  ]);
  type Row = {
    id: number; status: string; created_by: string; reason: string | null; created_at: string; expected_date: string | null; supplier_id: number;
    suppliers: OrderSupplier | null;
    purchase_order_lines: { ingredient_id: number; qty: number; est_unit_price: number | null; ingredients: { name: string } | null }[];
  };
  const rows = must(orders, "load purchase orders") as unknown as Row[];
  const name = (must(restaurant, "load the restaurant") as { name: string } | null)?.name ?? "the restaurant";

  // Pack sizes as the supplier sells them ("15 lb case"), from their latest price
  const packs = new Map<string, string>();
  if (rows.length) {
    const prices = must(
      await db.from("supplier_prices").select("supplier_id, ingredient_id, pack_desc, effective_date")
        .in("supplier_id", [...new Set(rows.map((r) => r.supplier_id))]).order("effective_date"),
      "load pack sizes",
    ) as { supplier_id: number; ingredient_id: number; pack_desc: string | null }[];
    for (const p of prices) if (p.pack_desc) packs.set(`${p.supplier_id}:${p.ingredient_id}`, p.pack_desc);
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  return rows.map((r) => {
    const supplier: OrderSupplier = r.suppliers ?? {
      name: "Unknown supplier", contact_name: null, phone: null, email: null, preferred_channel: null,
      lead_time_days: 1, min_order_amount: 0, delivery_days: null,
    };
    const lines: OrderLine[] = r.purchase_order_lines.map((l) => ({
      qty: Number(l.qty), est_unit_price: l.est_unit_price === null ? null : Number(l.est_unit_price),
      ingredient: l.ingredients?.name ?? "item", pack_desc: packs.get(`${r.supplier_id}:${l.ingredient_id}`) ?? null,
    }));
    // A sent order keeps the date agreed with the supplier; otherwise, the earliest it can arrive if sent today
    const delivery = r.status === "sent" && r.expected_date ? r.expected_date : nextDeliveryDate(today, supplier);
    const message = orderMessage(name, supplier, lines, delivery);
    return {
      id: r.id, status: r.status, created_by: r.created_by, reason: r.reason, created_at: r.created_at,
      supplier: supplier.name, lines, total: orderTotal(lines), below_minimum: belowMinimum(lines, supplier),
      min_order_amount: Number(supplier.min_order_amount ?? 0), delivery_date: delivery, message, contact: contactLink(supplier, message),
    };
  });
}

export async function setOrderStatus(db: Db, orderId: number, status: string) {
  const po = must(await db.from("purchase_orders").select("status").eq("id", orderId).eq("restaurant_id", RESTAURANT_ID).single(), "find that order") as { status: string };
  if (!(NEXT_STATUS[po.status] ?? []).includes(status)) throw new Error(`A ${po.status} order can't become ${status}`);
  must(
    await db.from("purchase_orders").update({ status, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) }).eq("id", orderId),
    "update the order",
  );
}
