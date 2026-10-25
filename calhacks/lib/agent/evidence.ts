// Loading what the investigations (lib/agent/investigate.ts) work from (server only). Each
// loader reads through the existing services or plain selects; the math stays in investigate.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockLine } from "@/lib/inventory/stock";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { FlagRow } from "./investigate";

type Db = SupabaseClient;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

// Invoice flags with their invoice number and supplier. Unresolved only unless asked.
export async function loadFlags(db: Db, opts: { ingredientId?: number; includeResolved?: boolean } = {}): Promise<FlagRow[]> {
  let q = db
    .from("invoice_flags")
    .select("id, invoice_id, ingredient_id, kind, message, money_impact, resolved, invoices!inner(invoice_number, restaurant_id, suppliers(name))")
    .eq("invoices.restaurant_id", RESTAURANT_ID)
    .order("id", { ascending: false })
    .limit(200);
  if (!opts.includeResolved) q = q.eq("resolved", false);
  if (opts.ingredientId) q = q.eq("ingredient_id", opts.ingredientId);
  type Row = Omit<FlagRow, "invoice_number" | "supplier"> & { invoices: { invoice_number: string | null; suppliers: { name: string } | null } | null };
  return (must(await q, "load invoice flags") as unknown as Row[]).map(({ invoices, ...f }) => ({
    ...f,
    money_impact: f.money_impact === null ? null : Number(f.money_impact),
    invoice_number: invoices?.invoice_number ?? null,
    supplier: invoices?.suppliers?.name ?? "A supplier",
  }));
}

// What each ingredient is used in a week, from the stock lines' average daily use. By name (lowercase).
export function weeklyUseByName(lines: StockLine[]): Map<string, { qty: number; unit: string }> {
  return new Map(lines.map((l) => [l.name.trim().toLowerCase(), { qty: l.daily_use * 7, unit: l.unit }]));
}

export async function loadRecipes(db: Db) {
  return must(await db.from("recipe_items").select("menu_item_id, ingredient_id, qty"), "load recipes") as { menu_item_id: number; ingredient_id: number; qty: number }[];
}

export async function loadDishes(db: Db) {
  return must(
    await db.from("menu_items").select("id, name, category, price").eq("restaurant_id", RESTAURANT_ID).eq("active", true).order("id"),
    "load the menu",
  ) as { id: number; name: string; category: string | null; price: number }[];
}

export async function loadDishSales(db: Db, days: number) {
  const rows = must(await db.rpc("dish_sales_by_day", { p_restaurant_id: RESTAURANT_ID, p_days: days }), "load past sales (has supabase/06_prep.sql been run?)") as { day: string; menu_item_id: number; units: number }[];
  return rows.map((r) => ({ ...r, units: Number(r.units) }));
}

// Order lines with their order time, since `sinceIso`. Pages through, since a month is ~2,000 lines.
export async function loadSaleLines(db: Db, sinceIso: string) {
  const out: { menu_item_id: number; ordered_at: string; qty: number; unit_price: number; order_id: number }[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const rows = must(
      await db
        .from("order_items")
        .select("menu_item_id, qty, unit_price, order_id, orders!inner(ordered_at, restaurant_id)")
        .eq("orders.restaurant_id", RESTAURANT_ID)
        .gte("orders.ordered_at", sinceIso)
        .order("id")
        .range(from, from + 999),
      "load order lines",
    ) as unknown as { menu_item_id: number; qty: number; unit_price: number; order_id: number; orders: { ordered_at: string } }[];
    out.push(...rows.map((r) => ({ menu_item_id: r.menu_item_id, ordered_at: r.orders.ordered_at, qty: Number(r.qty), unit_price: Number(r.unit_price), order_id: r.order_id })));
    if (rows.length < 1000) break;
  }
  return out;
}
