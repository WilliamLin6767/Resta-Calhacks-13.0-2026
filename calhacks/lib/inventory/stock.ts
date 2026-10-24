// Inventory (A2): what's on hand now, how long it lasts, and how far a count was from what we expected.
// Pure functions, no database calls and no AI.

export type SalesRow = { day: string; menu_item_id: number; units: number };
export type RecipeRow = { menu_item_id: number; ingredient_id: number; qty: number };
export type Ingredient = {
  id: number; name: string; unit: string; category: string | null; current_qty: number;
  par_level: number | null; reorder_point: number | null;
};
export type StockLine = Ingredient & {
  last_counted: string | null; // YYYY-MM-DD
  used_since: number; // by sales since that count, from recipes
  estimated: number; // current_qty - used_since
  daily_use: number; // average over the sales history
  days_left: number | null;
  status: "out" | "low" | "ok";
};

// Ingredient used per day by sales: units sold x recipe quantity
export function usageByDay(sales: SalesRow[], recipes: RecipeRow[]): Map<string, Map<number, number>> {
  const recipeByDish = new Map<number, RecipeRow[]>();
  for (const r of recipes) recipeByDish.set(r.menu_item_id, [...(recipeByDish.get(r.menu_item_id) ?? []), r]);
  const byDay = new Map<string, Map<number, number>>();
  for (const s of sales) {
    const day = byDay.get(s.day) ?? new Map<number, number>();
    for (const r of recipeByDish.get(s.menu_item_id) ?? []) day.set(r.ingredient_id, (day.get(r.ingredient_id) ?? 0) + Number(s.units) * Number(r.qty));
    byDay.set(s.day, day);
  }
  return byDay;
}

// Sales are by day, so a count is either before that day's service or after it.
// Before 11am = a morning count (that day's sales still come off); later = end of day.
export const MORNING_COUNT_BEFORE_HOUR = 11;

export type LastCount = { day: string; sales_from: string }; // count date, and the first day whose sales come off it

// When a count was taken (ISO timestamp) -> its day and the first day of sales after it, in local time
export function countDays(countedAt: string, timeZone = "America/Los_Angeles"): LastCount {
  const d = new Date(countedAt);
  const day = d.toLocaleDateString("en-CA", { timeZone });
  const hour = Number(d.toLocaleString("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }));
  if (hour < MORNING_COUNT_BEFORE_HOUR) return { day, sales_from: day };
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { day, sales_from: next.toISOString().slice(0, 10) };
}

// Stock now = the last count (plus deliveries and minus waste since, already in current_qty)
// minus what sales used after that count.
export function stockLines(
  ingredients: Ingredient[],
  lastCounted: Map<number, LastCount>,
  usage: Map<string, Map<number, number>>,
): StockLine[] {
  const days = [...usage.keys()].sort();
  const openDays = days.length || 1;
  return ingredients.map((ing) => {
    const counted = lastCounted.get(ing.id) ?? null;
    let usedSince = 0;
    let total = 0;
    for (const d of days) {
      const u = usage.get(d)!.get(ing.id) ?? 0;
      total += u;
      if (counted !== null && d >= counted.sales_from) usedSince += u;
    }
    const estimated = Math.max(0, Number(ing.current_qty) - usedSince);
    const dailyUse = total / openDays;
    const reorderAt = Number(ing.reorder_point ?? 0);
    return {
      ...ing,
      current_qty: Number(ing.current_qty),
      last_counted: counted?.day ?? null,
      used_since: round1(usedSince),
      estimated: round1(estimated),
      daily_use: round1(dailyUse),
      days_left: dailyUse > 0 ? Math.floor((estimated / dailyUse) * 10) / 10 : null,
      status: estimated <= 0 ? "out" : estimated <= reorderAt ? "low" : "ok",
    };
  });
}

// How much to order to get back to par, in the ingredient's unit
export function reorderQty(line: StockLine): number {
  return round1(Math.max(0, Number(line.par_level ?? 0) - line.estimated));
}

// Counted vs. expected. A big negative gap is stock that went somewhere without being logged:
// unrecorded waste, over-portioning, or theft. Small gaps are normal counting noise.
export function countGap(expected: number, counted: number) {
  const change = round1(counted - expected);
  const pct = expected > 0 ? Math.round((change / expected) * 100) : null;
  return { change, pct, notable: Math.abs(change) >= 0.5 && (pct === null || Math.abs(pct) >= 10) };
}

// A count reported in packs ("2 cases") becomes ingredient units
export function toUnits(qty: number, inPacks: boolean, packQty: number | null): number {
  return round1(inPacks && packQty ? qty * packQty : qty);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
