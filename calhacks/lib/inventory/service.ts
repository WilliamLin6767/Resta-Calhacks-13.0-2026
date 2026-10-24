// Inventory on top of Supabase (server only).
//   loadInventory     - stock now, recent changes, waste this week
//   saveCounts        - the owner confirmed counts (from a photo, a voice note or by hand)
//   logWaste          - stock thrown out, valued at cost
//   addInvoiceToStock - a scanned invoice is the delivery: its lines go into stock once
//   reorderLow        - draft orders to bring low items back to par
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOrders, loadSources } from "@/lib/purchasing/sources";
import { RESTAURANT_ID } from "@/lib/supabase";
import { countDays, countGap, reorderQty, stockLines, usageByDay, type Ingredient, type LastCount, type RecipeRow, type SalesRow, type StockLine } from "./stock";
import type { IngredientRef } from "./ai";

type Db = SupabaseClient;

export type StockEvent = {
  id: number; ingredient_id: number; kind: "delivery" | "count" | "waste"; change: number; qty_after: number;
  reason: string | null; unit_cost: number | null; source: string | null; created_at: string; ingredients: { name: string; unit: string } | null;
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export async function loadInventory(db: Db) {
  const today = todayLocal();
  const [ingredients, counts, sales, recipes, events, costs, sourcesResult] = await Promise.all([
    db.from("ingredients").select("id, name, unit, category, current_qty, par_level, reorder_point").eq("restaurant_id", RESTAURANT_ID).order("name"),
    db.from("inventory_counts").select("ingredient_id, counted_at").order("counted_at", { ascending: false }).limit(1000),
    db.rpc("dish_sales_by_day", { p_restaurant_id: RESTAURANT_ID, p_days: 28 }),
    db.from("recipe_items").select("menu_item_id, ingredient_id, qty"),
    db.from("stock_events")
      .select("id, ingredient_id, kind, change, qty_after, reason, unit_cost, source, created_at, ingredients(name, unit)")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("created_at", { ascending: false })
      .limit(40),
    db.from("v_ingredient_unit_cost").select("ingredient_id, unit_cost").eq("restaurant_id", RESTAURANT_ID),
    loadSources(db, today),
  ]);
  const ingredientRows = must(ingredients, "load ingredients") as Ingredient[];
  const lastCounted = new Map<number, LastCount>();
  for (const c of must(counts, "load counts") as { ingredient_id: number; counted_at: string }[]) {
    if (!lastCounted.has(c.ingredient_id)) lastCounted.set(c.ingredient_id, countDays(c.counted_at));
  }
  const usage = usageByDay(
    must(sales, "load past sales (has supabase/06_prep.sql been run?)") as SalesRow[],
    must(recipes, "load recipes") as RecipeRow[],
  );
  const lines = stockLines(ingredientRows, lastCounted, usage);
  const eventRows = must(events, "load stock changes (has supabase/08_inventory.sql been run?)") as unknown as StockEvent[];
  const unitCost = new Map((must(costs, "load costs") as { ingredient_id: number; unit_cost: number | null }[]).map((c) => [c.ingredient_id, Number(c.unit_cost ?? 0)]));
  const { sources } = sourcesResult;

  // Waste in the last 7 days, at cost
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const wasteRows = must(
    await db.from("stock_events").select("change, unit_cost").eq("restaurant_id", RESTAURANT_ID).eq("kind", "waste").gte("created_at", weekAgo),
    "load waste",
  ) as { change: number; unit_cost: number | null }[];
  const wasteWeek = wasteRows.reduce((s, w) => s + -Number(w.change) * Number(w.unit_cost ?? 0), 0);

  const refs: IngredientRef[] = ingredientRows.map((i) => ({ id: i.id, name: i.name, unit: i.unit, pack_desc: sources[i.id]?.pack_desc ?? null }));
  const packQty: Record<number, number> = {};
  for (const [id, s] of Object.entries(sources)) packQty[Number(id)] = s.pack_qty;

  return { today, lines, events: eventRows, wasteWeek, unitCost, refs, packQty, sources };
}

// Saves confirmed counts: sets stock, keeps the count, and records how far it was from what we expected.
export async function saveCounts(db: Db, items: { ingredient_id: number; qty: number }[], source: "photo" | "voice" | "manual") {
  const { lines, unitCost } = await loadInventory(db);
  const byId = new Map(lines.map((l) => [l.id, l]));
  let saved = 0;
  for (const item of items) {
    const line = byId.get(item.ingredient_id);
    if (!line || !Number.isFinite(item.qty) || item.qty < 0) continue;
    const qty = Math.round(item.qty * 100) / 100;
    const gap = countGap(line.estimated, qty);
    must(await db.from("ingredients").update({ current_qty: qty }).eq("id", line.id).eq("restaurant_id", RESTAURANT_ID), "update stock");
    must(await db.from("inventory_counts").insert({ ingredient_id: line.id, qty, source }), "save the count");
    must(
      await db.from("stock_events").insert({
        restaurant_id: RESTAURANT_ID, ingredient_id: line.id, kind: "count", change: gap.change, qty_after: qty,
        reason: `expected ${line.estimated}`, unit_cost: unitCost.get(line.id) ?? null, source,
      }),
      "log the count",
    );
    saved++;
  }
  return saved;
}

export const WASTE_REASONS = ["spoiled", "expired", "dropped", "overcooked", "returned", "other"] as const;

export async function logWaste(db: Db, items: { ingredient_id: number; qty: number; reason: string }[], source: "voice" | "manual") {
  const { lines, unitCost } = await loadInventory(db);
  const byId = new Map(lines.map((l) => [l.id, l]));
  let saved = 0;
  for (const item of items) {
    const line = byId.get(item.ingredient_id);
    if (!line || !Number.isFinite(item.qty) || item.qty <= 0) continue;
    const reason = (WASTE_REASONS as readonly string[]).includes(item.reason) ? item.reason : "other";
    const after = Math.max(0, Math.round((line.current_qty - item.qty) * 100) / 100);
    must(await db.from("ingredients").update({ current_qty: after }).eq("id", line.id).eq("restaurant_id", RESTAURANT_ID), "update stock");
    must(
      await db.from("stock_events").insert({
        restaurant_id: RESTAURANT_ID, ingredient_id: line.id, kind: "waste", change: -Math.round(item.qty * 100) / 100,
        qty_after: Math.max(0, line.estimated - item.qty), reason, unit_cost: unitCost.get(line.id) ?? null, source,
      }),
      "log the waste",
    );
    saved++;
  }
  return saved;
}

// Adds every matched line of an invoice to stock (delivered qty x units per pack), each line once.
// Lines without a sure match or a pack size wait until someone confirms them.
export async function addInvoiceToStock(db: Db, invoiceId: number) {
  const lines = must(
    await db.from("invoice_lines")
      .select("id, ingredient_id, qty, pack_qty, unit_price, invoices!inner(invoice_number, restaurant_id)")
      .eq("invoice_id", invoiceId).eq("added_to_stock", false).eq("needs_review", false)
      .not("ingredient_id", "is", null).not("pack_qty", "is", null),
    "load invoice lines",
  ) as unknown as { id: number; ingredient_id: number; qty: number; pack_qty: number; unit_price: number; invoices: { invoice_number: string | null } }[];
  for (const l of lines) {
    const added = Number(l.qty) * Number(l.pack_qty);
    if (!(added > 0)) continue;
    const ing = must(await db.from("ingredients").select("current_qty").eq("id", l.ingredient_id).single(), "load stock") as { current_qty: number };
    const after = Math.round((Number(ing.current_qty) + added) * 100) / 100;
    must(await db.from("ingredients").update({ current_qty: after }).eq("id", l.ingredient_id), "update stock");
    must(await db.from("invoice_lines").update({ added_to_stock: true }).eq("id", l.id), "mark the line received");
    must(
      await db.from("stock_events").insert({
        restaurant_id: RESTAURANT_ID, ingredient_id: l.ingredient_id, kind: "delivery", change: added, qty_after: after,
        reason: l.invoices?.invoice_number ? `invoice ${l.invoices.invoice_number}` : "invoice", unit_cost: Number(l.unit_price) / Number(l.pack_qty),
        invoice_line_id: l.id, source: "invoice",
      }),
      "log the delivery",
    );
  }
}

export async function reorderLow(db: Db) {
  const { lines, sources } = await loadInventory(db);
  const low: StockLine[] = lines.filter((l) => l.status !== "ok" && reorderQty(l) > 0);
  return draftOrders(
    db,
    sources,
    low.map((l) => ({ ingredient_id: l.id, qty: reorderQty(l), note: `${l.name}: about ${l.estimated} ${l.unit} left, par is ${l.par_level} ${l.unit}` })),
    "Low stock.",
  );
}
