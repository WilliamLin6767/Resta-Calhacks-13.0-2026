// Where each ingredient is ordered from, and every supplier's offer (server only).
// Used by prep planning (A3), inventory (A2) and the order plan (planService.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESTAURANT_ID } from "@/lib/supabase";
import { nextDeliveryDate } from "./orders";
import type { Offer, SupplierInfo } from "./plan";

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
    db.from("suppliers").select("id, name, lead_time_days, delivery_days, min_order_amount").eq("restaurant_id", RESTAURANT_ID),
  ]);
  const ingredientRows = must(ingredients, "load ingredients") as { id: number; preferred_supplier_id: number | null }[];
  const supplierRows = must(suppliers, "load suppliers") as {
    id: number; name: string; lead_time_days: number | null; delivery_days: string | null; min_order_amount: number | null;
  }[];
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
  // Everything the order plan (plan.ts) compares: every supplier's latest offer, minimums, delivery dates
  const supplierInfo: SupplierInfo[] = supplierRows.map((s) => ({
    id: s.id, name: s.name, min_order_amount: Number(s.min_order_amount ?? 0), earliest_delivery: nextDeliveryDate(today, s),
  }));
  const preferred = new Map(ingredientRows.map((i) => [i.id, i.preferred_supplier_id]));
  return { sources, latest, offers: [...latest.values()] as Offer[], suppliers: supplierInfo, preferred };
}
