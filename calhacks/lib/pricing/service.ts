// Menu pricing on top of Supabase (server only).
//   loadPricing          - every dish's cost today vs. a month ago, with price suggestions
//   changePrice          - the owner approves a new in-house price; logged in menu_price_changes
//   applyDeliveryPrices  - set every app price that's too low to the suggested one
//   markUpdated          - the owner has updated the POS / DoorDash / Uber Eats with a change
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Digest } from "@/lib/analytics";
import { RESTAURANT_ID } from "@/lib/supabase";
import {
  deliveryPlan, dishCosts, suggestPrice, unitCostsAt,
  type DeliveryPlan, type Dish, type IngredientRow, type PriceRow, type RecipeRow, type Suggestion,
} from "./pricing";

type Db = SupabaseClient;

// The systems a price lives in besides this app, as columns of menu_price_changes
export const SYSTEMS = { pos: "POS", doordash: "DoorDash", ubereats: "Uber Eats" } as const;
export type System = keyof typeof SYSTEMS;

export type PriceChange = {
  id: number; menu_item_id: number; old_price: number; new_price: number;
  old_delivery_price: number | null; new_delivery_price: number | null; reason: string | null; changed_at: string;
  pos_updated: boolean; doordash_updated: boolean; ubereats_updated: boolean;
  menu_items: { name: string } | null;
};

export type Pricing = {
  since: string; // costs are compared with this date
  suggestions: Suggestion[];
  delivery: DeliveryPlan;
  changes: PriceChange[]; // newest first
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

// Today's date in the restaurant's time zone, as YYYY-MM-DD
function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export async function loadPricing(db: Db, days = 30): Promise<Pricing> {
  const [menu, ingredients, suppliers, digest, changes, repriced] = await Promise.all([
    db.from("menu_items").select("id, name, category, price, delivery_price").eq("restaurant_id", RESTAURANT_ID).eq("active", true).order("id"),
    db.from("ingredients").select("id, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID),
    db.from("suppliers").select("id").eq("restaurant_id", RESTAURANT_ID),
    // Units sold, menu class and delivery-app fees come from the same digest the analytics pages use.
    db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: days }),
    db.from("menu_price_changes")
      .select("id, menu_item_id, old_price, new_price, old_delivery_price, new_delivery_price, reason, changed_at, pos_updated, doordash_updated, ubereats_updated, menu_items(name)")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("changed_at", { ascending: false })
      .limit(20),
    // When each dish's in-house price last changed
    db.from("menu_price_changes").select("menu_item_id, changed_at, old_price, new_price").eq("restaurant_id", RESTAURANT_ID),
  ]);
  const menuRows = must(menu, "load the menu") as { id: number; name: string; category: string | null; price: number; delivery_price: number | null }[];
  const d = must(digest, "load the sales summary") as Digest;
  const supplierIds = (must(suppliers, "load suppliers") as { id: number }[]).map((s) => s.id);

  const [recipes, prices] = await Promise.all([
    db.from("recipe_items").select("menu_item_id, ingredient_id, qty").in("menu_item_id", menuRows.map((m) => m.id)),
    db.from("supplier_prices").select("supplier_id, ingredient_id, pack_qty, price, effective_date").in("supplier_id", supplierIds),
  ]);
  const recipeRows = must(recipes, "load recipes") as RecipeRow[];
  const priceRows = must(prices, "load supplier prices") as PriceRow[];
  const ingredientRows = must(ingredients, "load ingredients") as IngredientRow[];

  // Cost per serving today, and at the start of the period. A dish repriced since then is compared
  // with its cost on the day of that change instead, so a cost rise already passed on isn't counted twice.
  const since = d.period.start;
  const costNow = dishCosts(recipeRows, unitCostsAt(priceRows, ingredientRows, today()));
  const lastRepriced = new Map<number, string>();
  for (const c of must(repriced, "load price changes") as { menu_item_id: number; changed_at: string; old_price: number; new_price: number }[]) {
    if (Number(c.old_price) === Number(c.new_price)) continue;
    const day = new Date(c.changed_at).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    if (day > (lastRepriced.get(c.menu_item_id) ?? since)) lastRepriced.set(c.menu_item_id, day);
  }
  const costsOn = new Map<string, Map<number, number>>();
  const costBeforeFor = (dishId: number) => {
    const day = lastRepriced.get(dishId) ?? since;
    if (!costsOn.has(day)) costsOn.set(day, dishCosts(recipeRows, unitCostsAt(priceRows, ingredientRows, day)));
    return costsOn.get(day)!.get(dishId) ?? 0;
  };

  // Share of sales through delivery apps, and the commission they keep
  const apps = d.channels.filter((c) => Number(c.platform_fees) > 0);
  const totalRevenue = d.channels.reduce((s, c) => s + Number(c.revenue), 0);
  const appRevenue = apps.reduce((s, c) => s + Number(c.revenue), 0);
  const share = totalRevenue > 0 ? appRevenue / totalRevenue : 0;
  const fee = appRevenue > 0 ? apps.reduce((s, c) => s + Number(c.platform_fees), 0) / appRevenue : 0;

  // The digest lists dishes by name; names are unique on a menu.
  const sales = new Map(d.menu.map((m) => [m.name, m]));
  const dishes: Dish[] = menuRows.map((m) => {
    const s = sales.get(m.name);
    return {
      id: m.id, name: m.name, category: m.category, price: Number(m.price),
      delivery_price: m.delivery_price === null ? null : Number(m.delivery_price),
      units: Number(s?.units ?? 0), units_change_pct: s?.units_change_pct ?? null, class: s?.class ?? null,
    };
  });

  const order = { raise: 0, review: 1, ok: 2 };
  const suggestions = dishes
    .map((dish) => suggestPrice(dish, costNow.get(dish.id) ?? 0, costBeforeFor(dish.id), share, fee))
    .sort((a, b) => order[a.action] - order[b.action] || b.extra_profit - a.extra_profit);

  return { since, suggestions, delivery: deliveryPlan(dishes, share, fee), changes: must(changes, "load price changes") as unknown as PriceChange[] };
}

// The owner approves a new in-house price for one dish.
export async function changePrice(db: Db, menuItemId: number, newPrice: number, reason: string) {
  if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice >= 1000) throw new Error("Enter a price between $0 and $1,000");
  const item = must(
    await db.from("menu_items").select("id, price, delivery_price").eq("id", menuItemId).eq("restaurant_id", RESTAURANT_ID).single(),
    "find that dish",
  ) as { id: number; price: number; delivery_price: number | null };
  const rounded = Math.round(newPrice * 100) / 100;
  must(await db.from("menu_items").update({ price: rounded }).eq("id", item.id), "update the price");
  must(
    await db.from("menu_price_changes").insert({
      restaurant_id: RESTAURANT_ID, menu_item_id: item.id, old_price: item.price, new_price: rounded,
      old_delivery_price: item.delivery_price, new_delivery_price: item.delivery_price, reason,
    }),
    "log the price change",
  );
}

// Sets every delivery-app price the plan says is too low. The plan is worked out again here,
// so the browser can't send its own prices.
export async function applyDeliveryPrices(db: Db) {
  const { delivery } = await loadPricing(db);
  for (const p of delivery.prices) {
    must(await db.from("menu_items").update({ delivery_price: p.new_delivery_price }).eq("id", p.menu_item_id), "update a delivery price");
    must(
      await db.from("menu_price_changes").insert({
        restaurant_id: RESTAURANT_ID, menu_item_id: p.menu_item_id, old_price: p.price, new_price: p.price,
        old_delivery_price: p.delivery_price, new_delivery_price: p.new_delivery_price,
        reason: `Delivery apps keep ${delivery.fee_pct}%`, pos_updated: true, // the POS menu doesn't change
      }),
      "log a delivery price change",
    );
  }
  return delivery.prices.length;
}

export async function markUpdated(db: Db, changeId: number, system: System) {
  must(
    await db.from("menu_price_changes").update({ [`${system}_updated`]: true }).eq("id", changeId).eq("restaurant_id", RESTAURANT_ID),
    "save that",
  );
}
