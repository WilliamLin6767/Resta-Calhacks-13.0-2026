// Prep planning on top of Supabase (server only).
//   loadPrep        - the forecast for a day, stock expected by then, and where each ingredient comes from
//   orderShortfalls - draft purchase orders for everything the day is short on
import type { SupabaseClient } from "@supabase/supabase-js";
import { countDays, stockLines, usageByDay, type LastCount } from "@/lib/inventory/stock";
import { draftOrders, loadSources, type Source } from "@/lib/purchasing/sources";
import { RESTAURANT_ID } from "@/lib/supabase";
import {
  adjustForecast, forecastDay, prepNeeds, projectStock, weekdayName,
  type Forecast, type RecipeRow, type SalesRow, type StockRow,
} from "./forecast";

type Db = SupabaseClient;

export type { Source };

export type Prep = {
  today: string;
  date: string;
  days: { date: string; weekday: string; closed: boolean }[]; // the next 7 days, for the day picker
  forecast: Forecast;
  recipes: RecipeRow[];
  stock: StockRow[];
  sources: Record<number, Source>; // ingredient id -> where it's ordered from
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function loadPrep(db: Db, date: string): Promise<Prep> {
  const today = todayLocal();
  const [sales, menu, recipes, ingredients, orders, counts] = await Promise.all([
    db.rpc("dish_sales_by_day", { p_restaurant_id: RESTAURANT_ID, p_days: 56 }),
    db.from("menu_items").select("id, name").eq("restaurant_id", RESTAURANT_ID).eq("active", true).order("id"),
    db.from("recipe_items").select("menu_item_id, ingredient_id, qty"),
    db.from("ingredients").select("id, name, unit, category, current_qty, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID),
    db.from("purchase_orders").select("supplier_id, purchase_order_lines(ingredient_id, qty)").eq("restaurant_id", RESTAURANT_ID).in("status", ["draft", "approved", "sent"]),
    db.from("inventory_counts").select("ingredient_id, counted_at").order("counted_at", { ascending: false }).limit(1000),
  ]);
  const salesRows = (must(sales, "load past sales (has supabase/06_prep.sql been run?)") as SalesRow[]).map((r) => ({ ...r, units: Number(r.units) }));
  const dishes = must(menu, "load the menu") as { id: number; name: string }[];
  const dishIds = new Set(dishes.map((d) => d.id));
  const recipeRows = (must(recipes, "load recipes") as RecipeRow[]).filter((r) => dishIds.has(r.menu_item_id));
  const ingredientRows = must(ingredients, "load ingredients") as {
    id: number; name: string; unit: string; category: string | null; current_qty: number; preferred_supplier_id: number | null;
  }[];
  const orderRows = must(orders, "load open orders") as unknown as { supplier_id: number; purchase_order_lines: { ingredient_id: number; qty: number }[] }[];

  const { sources, latest } = await loadSources(db, today);

  // Already on order (in the ingredient's unit): packs x pack size
  const onOrder = new Map<number, number>();
  for (const o of orderRows) {
    for (const l of o.purchase_order_lines) {
      const pack = Number(latest.get(`${o.supplier_id}:${l.ingredient_id}`)?.pack_qty ?? 1);
      onOrder.set(l.ingredient_id, (onOrder.get(l.ingredient_id) ?? 0) + Number(l.qty) * pack);
    }
  }

  // Stock at the start of the day: stock now minus what the days in between should use
  const daysBefore: Forecast[] = [];
  for (let d = addDays(today, 1); d < date; d = addDays(d, 1)) daysBefore.push(forecastDay(salesRows, dishes, d));
  // Starting point: the last count minus what sales used since (see lib/inventory/stock.ts)
  const lastCounted = new Map<number, LastCount>();
  for (const c of must(counts, "load counts") as { ingredient_id: number; counted_at: string }[]) {
    if (!lastCounted.has(c.ingredient_id)) lastCounted.set(c.ingredient_id, countDays(c.counted_at));
  }
  const now = stockLines(ingredientRows.map((i) => ({ ...i, par_level: null, reorder_point: null })), lastCounted, usageByDay(salesRows, recipeRows));
  const projected = projectStock(new Map(now.map((l) => [l.id, l.estimated])), recipeRows, daysBefore);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i + 1);
    return { date: d, weekday: weekdayName(d), closed: forecastDay(salesRows, [], d).closed };
  });

  return {
    today,
    date,
    days,
    forecast: forecastDay(salesRows, dishes, date),
    recipes: recipeRows,
    stock: ingredientRows.map((i) => ({
      id: i.id, name: i.name, unit: i.unit, category: i.category, on_hand: projected.get(i.id) ?? 0, on_order: onOrder.get(i.id) ?? 0,
    })),
    sources,
  };
}

// Draft purchase orders (one per supplier) for every ingredient the day is short on (not just tight).
// The forecast is worked out again here, with the AI factors clamped, so the browser can't send its own amounts.
export async function orderShortfalls(db: Db, date: string, factors: Record<number, number>) {
  const prep = await loadPrep(db, date);
  const needs = prepNeeds(adjustForecast(prep.forecast, factors), prep.recipes, prep.stock).filter((n) => n.short > 0 && !n.tight);
  const day = `${prep.forecast.weekday} ${date}`;
  return draftOrders(
    db,
    prep.sources,
    needs.map((n) => ({
      ingredient_id: n.ingredient_id,
      qty: n.short,
      note: `${n.name}: ${n.needed_busy} ${n.unit} on a busy day, ${round1(n.on_hand + n.on_order)} ${n.unit} on hand or ordered`,
    })),
    `Prep for ${day}.`,
    date,
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
