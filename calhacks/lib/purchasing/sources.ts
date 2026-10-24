// Where each ingredient is ordered from, and drafting orders for it (server only).
// Used by prep planning (A3) and inventory (A2).
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";
import { nextDeliveryDate } from "./orders";

type Db = SupabaseClient;

export type Source = {
  supplier_id: number; supplier: string; pack_desc: string | null; pack_qty: number; price: number;
  earliest_delivery: string; // if ordered today
};
export type LatestPrice = { supplier_id: number; ingredient_id: number; pack_desc: string | null; pack_qty: number; price: number };

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

// For every ingredient: the preferred supplier's latest price and pack, else the cheapest supplier's.
// Also returns the latest price per "supplier:ingredient", for pack sizes on open orders.
export async function loadSources(db: Db, today: string) {
  const [ingredients, suppliers] = await Promise.all([
    db.from("ingredients").select("id, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID),
    db.from("suppliers").select("id, name, lead_time_days, delivery_days").eq("restaurant_id", RESTAURANT_ID),
  ]);
  const ingredientRows = must(ingredients, "load ingredients") as { id: number; preferred_supplier_id: number | null }[];
  const supplierRows = must(suppliers, "load suppliers") as { id: number; name: string; lead_time_days: number | null; delivery_days: string | null }[];
  const prices = must(
    await db.from("supplier_prices").select("supplier_id, ingredient_id, pack_desc, pack_qty, price, effective_date")
      .in("supplier_id", supplierRows.map((s) => s.id)).order("effective_date"),
    "load supplier prices",
  ) as LatestPrice[];
  const latest = new Map<string, LatestPrice>();
  for (const p of prices) latest.set(`${p.supplier_id}:${p.ingredient_id}`, p);

  const supplierById = new Map(supplierRows.map((s) => [s.id, s]));
  const sources: Record<number, Source> = {};
  for (const ing of ingredientRows) {
    let pick = ing.preferred_supplier_id ? latest.get(`${ing.preferred_supplier_id}:${ing.id}`) : undefined;
    if (!pick) {
      for (const p of latest.values()) {
        if (p.ingredient_id === ing.id && (!pick || p.price / p.pack_qty < pick.price / pick.pack_qty)) pick = p;
      }
    }
    const supplier = pick && supplierById.get(pick.supplier_id);
    if (pick && supplier) {
      sources[ing.id] = {
        supplier_id: supplier.id, supplier: supplier.name, pack_desc: pick.pack_desc, pack_qty: Number(pick.pack_qty), price: Number(pick.price),
        earliest_delivery: nextDeliveryDate(today, supplier),
      };
    }
  }
  return { sources, latest };
}

// One draft purchase order per supplier. `items` are amounts in the ingredient's unit; they're rounded
// up to whole packs. Returns the new order ids.
export async function draftOrders(
  db: Db,
  sources: Record<number, Source>,
  items: { ingredient_id: number; qty: number; note: string }[],
  reasonPrefix: string,
  neededBy?: string,
) {
  const bySupplier = new Map<number, { lines: { ingredient_id: number; qty: number; est_unit_price: number }[]; notes: string[]; late: boolean }>();
  for (const item of items) {
    const src = sources[item.ingredient_id];
    if (!src || item.qty <= 0) continue;
    const entry = bySupplier.get(src.supplier_id) ?? { lines: [], notes: [], late: false };
    entry.lines.push({ ingredient_id: item.ingredient_id, qty: Math.ceil(item.qty / src.pack_qty), est_unit_price: src.price });
    entry.notes.push(item.note);
    entry.late ||= Boolean(neededBy && src.earliest_delivery > neededBy);
    bySupplier.set(src.supplier_id, entry);
  }
  const created: number[] = [];
  for (const [supplierId, entry] of bySupplier) {
    const late = entry.late ? " Their earliest delivery is after that day, so this may arrive late." : "";
    const po = must(
      await db.from("purchase_orders").insert({
        restaurant_id: RESTAURANT_ID, supplier_id: supplierId, status: "draft", created_by: "ai", expected_date: neededBy ?? null,
        reason: `${reasonPrefix} ${entry.notes.join("; ")}.${late}`,
      }).select("id").single(),
      "create the order",
    ) as { id: number };
    must(await db.from("purchase_order_lines").insert(entry.lines.map((l) => ({ ...l, purchase_order_id: po.id }))), "add the order lines");
    created.push(po.id);
  }
  return created;
}
