// Menu pricing (A4): what each dish costs to make today vs. a month ago, and what to charge.
// Pure functions, no database calls and no AI: the same inputs always give the same suggestion.

// What the owner aims for: food cost at or below 30% of the menu price (a common restaurant target).
export const TARGET_FOOD_COST = 0.3;
// Only suggest keeping up with a cost rise of at least 3%; smaller changes are noise.
export const COST_RISE_MIN = 0.03;
// Never suggest raising a price more than 10% at once; customers notice big jumps.
export const MAX_RAISE = 0.1;
// Delivery apps take a commission, so most restaurants charge about 20% more there.
export const DELIVERY_MARKUP = 0.2;
// Menu prices end in .25, .50, .75 or .95.
const ENDINGS = [0.25, 0.5, 0.75, 0.95];

export type PriceRow = { supplier_id: number; ingredient_id: number; pack_qty: number; price: number; effective_date: string };
export type IngredientRow = { id: number; preferred_supplier_id: number | null };
export type RecipeRow = { menu_item_id: number; ingredient_id: number; qty: number };
export type Dish = {
  id: number;
  name: string;
  category: string | null;
  price: number;
  delivery_price: number | null; // null = same as the in-house price
  units: number; // sold in the last period
  units_change_pct: number | null; // vs. the period before
  class: "star" | "plowhorse" | "puzzle" | "dog" | null; // menu engineering class from analytics
};

// Cost per unit (lb, oz, ea...) of every ingredient on `date` (YYYY-MM-DD), the same way the
// database view v_ingredient_unit_cost does it: the preferred supplier's latest price on or before
// that date, else the cheapest supplier's. Before an ingredient's first price, its earliest price is used.
export function unitCostsAt(prices: PriceRow[], ingredients: IngredientRow[], date: string): Map<number, number> {
  // Latest unit cost per (supplier, ingredient) on or before the date, and the earliest one as a fallback.
  const latest = new Map<string, { date: string; cost: number }>();
  const earliest = new Map<number, { date: string; cost: number }>();
  for (const p of prices) {
    const cost = Number(p.price) / Number(p.pack_qty);
    const first = earliest.get(p.ingredient_id);
    if (!first || p.effective_date < first.date) earliest.set(p.ingredient_id, { date: p.effective_date, cost });
    if (p.effective_date > date) continue;
    const key = `${p.supplier_id}:${p.ingredient_id}`;
    const seen = latest.get(key);
    if (!seen || p.effective_date > seen.date) latest.set(key, { date: p.effective_date, cost });
  }

  const costs = new Map<number, number>();
  for (const ing of ingredients) {
    const preferred = latest.get(`${ing.preferred_supplier_id}:${ing.id}`);
    let cost = preferred?.cost;
    if (cost === undefined) {
      for (const [key, v] of latest) {
        if (key.endsWith(`:${ing.id}`) && (cost === undefined || v.cost < cost)) cost = v.cost;
      }
    }
    cost ??= earliest.get(ing.id)?.cost;
    if (cost !== undefined) costs.set(ing.id, cost);
  }
  return costs;
}

// Food cost of one serving of each dish: recipe quantity x ingredient unit cost, summed.
export function dishCosts(recipes: RecipeRow[], unitCosts: Map<number, number>): Map<number, number> {
  const totals = new Map<number, number>();
  for (const r of recipes) {
    totals.set(r.menu_item_id, (totals.get(r.menu_item_id) ?? 0) + Number(r.qty) * (unitCosts.get(r.ingredient_id) ?? 0));
  }
  return totals;
}

// The lowest menu-style price at or above `needed`: 18.73 -> 18.75, 16.10 -> 16.25, 16.96 -> 17.25
export function menuPriceAtLeast(needed: number): number {
  const dollars = Math.floor(needed);
  for (const d of [dollars, dollars + 1]) {
    for (const e of ENDINGS) if (d + e >= needed - 0.005) return round2(d + e);
  }
  return round2(dollars + 1 + ENDINGS[ENDINGS.length - 1]);
}

// The highest menu-style price at or below `limit`: 17.55 -> 17.50
export function menuPriceAtMost(limit: number): number {
  const dollars = Math.floor(limit);
  for (const d of [dollars, dollars - 1]) {
    for (const e of [...ENDINGS].reverse()) if (d + e <= limit + 0.005) return round2(d + e);
  }
  return round2(dollars - 1);
}

export type Suggestion = {
  dish: Dish;
  cost_now: number;
  cost_before: number;
  cost_change_pct: number | null;
  food_cost_pct: number; // at today's price
  // "raise": change the price. "review": the numbers say raise, but the dish doesn't sell well,
  // so the owner should look first. "ok": nothing to do.
  action: "raise" | "review" | "ok";
  new_price: number | null; // suggested in-house price
  reasons: string[]; // plain sentences for the owner
  in_steps: boolean; // the full raise is over MAX_RAISE, so this is step one
  extra_profit: number; // per period if the same number sell (rough estimate)
};

// Pricing advice for one dish. `deliveryShare` = share of sales through delivery apps (0-1) and
// `deliveryFee` = their commission (0-1), both from the analytics digest: delivery orders follow
// the in-house price unless the dish has its own delivery price, and the apps keep their cut.
export function suggestPrice(dish: Dish, costNow: number, costBefore: number, deliveryShare: number, deliveryFee: number): Suggestion {
  const price = Number(dish.price);
  const reasons: string[] = [];
  const costChange = costBefore > 0 ? (costNow - costBefore) / costBefore : null;

  // Two reasons to charge more; we take whichever needs the higher price:
  //  1. Food cost is above the target: the price that brings it back to the target.
  //  2. Ingredients got pricier: pass the increase on, so each dish earns what it did before.
  let needed = price;
  if (costNow / price > TARGET_FOOD_COST) {
    needed = Math.max(needed, costNow / TARGET_FOOD_COST);
    reasons.push(`Food cost is ${pct(costNow / price)} of the price, above the ${pct(TARGET_FOOD_COST)} target.`);
  }
  if (costChange !== null && costChange >= COST_RISE_MIN) {
    needed = Math.max(needed, price + (costNow - costBefore));
    reasons.push(`Ingredients for one serving went from ${money(costBefore)} to ${money(costNow)} (+${pct(costChange)}).`);
  }

  let newPrice: number | null = null;
  let inSteps = false;
  if (needed > price + 0.005) {
    newPrice = menuPriceAtLeast(needed);
    if (newPrice > price * (1 + MAX_RAISE)) {
      newPrice = Math.max(menuPriceAtMost(price * (1 + MAX_RAISE)), menuPriceAtLeast(price + 0.01));
      inSteps = true;
      reasons.push(`The full raise would be over ${pct(MAX_RAISE)}, so this is a first step.`);
    }
  }

  // A low seller may sell even less at a higher price: show the number, but leave it to the owner.
  const lowSeller = dish.class === "dog" || dish.class === "puzzle";
  if (newPrice && lowSeller) {
    reasons.push("It doesn't sell much, so a higher price may not help. Look at the recipe or portion first.");
  }
  if (newPrice && dish.units_change_pct !== null && dish.units_change_pct <= -10) {
    reasons.push(`Sales are already down ${Math.abs(dish.units_change_pct)}% from the period before.`);
  }
  const action: Suggestion["action"] = !newPrice ? "ok" : lowSeller ? "review" : "raise";

  const gain = action === "raise" && newPrice ? newPrice - price : 0;
  const deliveryGain = dish.delivery_price === null ? gain * (1 - deliveryFee) : 0;
  const extra = dish.units * ((1 - deliveryShare) * gain + deliveryShare * deliveryGain);

  return {
    dish,
    cost_now: round2(costNow),
    cost_before: round2(costBefore),
    cost_change_pct: costChange === null ? null : Math.round(costChange * 1000) / 10,
    food_cost_pct: Math.round((costNow / price) * 1000) / 10,
    action,
    new_price: newPrice,
    reasons,
    in_steps: inSteps,
    extra_profit: round2(extra),
  };
}

export type DeliveryPlan = {
  fee_pct: number; // what the apps keep, e.g. 25
  share_pct: number; // share of sales through the apps, e.g. 28.2
  prices: { menu_item_id: number; name: string; price: number; delivery_price: number; new_delivery_price: number }[];
  extra_profit: number; // per period if the same number sell (rough estimate)
};

// Delivery apps take a commission, so the app menu should cost about DELIVERY_MARKUP more than the
// in-house menu. Lists the dishes whose app price is clearly below that, with a menu-style new price.
export function deliveryPlan(dishes: Dish[], deliveryShare: number, deliveryFee: number): DeliveryPlan {
  const prices: DeliveryPlan["prices"] = [];
  let extra = 0;
  for (const d of dishes) {
    const price = Number(d.price);
    const current = Number(d.delivery_price ?? d.price);
    const target = menuPriceAtLeast(price * (1 + DELIVERY_MARKUP));
    if (deliveryFee <= 0 || current >= target - 0.3) continue;
    prices.push({ menu_item_id: d.id, name: d.name, price, delivery_price: current, new_delivery_price: target });
    extra += d.units * deliveryShare * (target - current) * (1 - deliveryFee);
  }
  return {
    fee_pct: Math.round(deliveryFee * 1000) / 10,
    share_pct: Math.round(deliveryShare * 1000) / 10,
    prices,
    extra_profit: round2(extra),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function pct(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}
function money(n: number) {
  return `$${n.toFixed(2)}`;
}
