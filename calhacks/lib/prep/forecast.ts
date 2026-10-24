// Prep planning (A3): how many of each dish will sell on a day, and what that means for prep and stock.
// Pure functions, no database calls and no AI. Safe to use in the browser too.

// How many past same-weekdays the forecast looks at, most recent first, and how much each counts.
// Recent weeks count more, so a trend shows up without a model that needs months of data.
export const WEEK_WEIGHTS = [4, 3, 2, 1];
// The AI may scale a dish's forecast, but only within this range.
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 2;

export type SalesRow = { day: string; menu_item_id: number; units: number };
export type DishRef = { id: number; name: string };
export type DishForecast = {
  id: number;
  name: string;
  expected: number; // dishes
  low: number; // quietest of the weeks looked at
  high: number; // busiest of the weeks looked at
  history: number[]; // units on each past same weekday, oldest first
  confidence: "high" | "medium" | "low";
};
export type Forecast = {
  date: string;
  weekday: string;
  closed: boolean; // no sales on this weekday in the history: the restaurant is closed that day
  days_used: string[]; // the past same-weekdays the forecast is based on, newest first
  dishes: DishForecast[];
};

export function weekdayName(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

// Forecast for `date` from daily sales before it: a weighted average of the same weekday in recent weeks.
export function forecastDay(rows: SalesRow[], dishes: DishRef[], date: string): Forecast {
  const target = new Date(`${date}T12:00:00Z`).getUTCDay();
  const openDays = [...new Set(rows.map((r) => r.day))].filter((d) => d < date).sort().reverse();
  const sameDays = openDays.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === target).slice(0, WEEK_WEIGHTS.length);

  const units = new Map<string, number>();
  for (const r of rows) units.set(`${r.day}:${r.menu_item_id}`, (units.get(`${r.day}:${r.menu_item_id}`) ?? 0) + Number(r.units));

  const result = dishes.map((dish) => {
    const values = sameDays.map((d) => units.get(`${d}:${dish.id}`) ?? 0); // newest first
    const weights = WEEK_WEIGHTS.slice(0, values.length);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const expected = totalWeight ? values.reduce((s, v, i) => s + v * weights[i], 0) / totalWeight : 0;
    return {
      id: dish.id,
      name: dish.name,
      expected: Math.round(expected),
      low: values.length ? Math.min(...values) : 0,
      high: values.length ? Math.max(...values) : 0,
      history: [...values].reverse(),
      confidence: confidence(values),
    };
  });

  return { date, weekday: weekdayName(date), closed: openDays.length > 0 && sameDays.length === 0, days_used: sameDays, dishes: result };
}

// High: 4 weeks of history that agree with each other. Low: under 2 weeks, or weeks all over the place.
function confidence(values: number[]): DishForecast["confidence"] {
  if (values.length < 2) return "low";
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return "low";
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const spread = sd / mean;
  if (values.length >= 4 && spread < 0.2) return "high";
  return spread < 0.4 ? "medium" : "low";
}

// Applies the AI's adjustments (dish id -> factor), clamped to MIN_FACTOR..MAX_FACTOR.
export function adjustForecast(forecast: Forecast, factors: Record<number, number>): Forecast {
  return {
    ...forecast,
    dishes: forecast.dishes.map((d) => {
      const f = clampFactor(factors[d.id] ?? 1);
      return f === 1 ? d : { ...d, expected: Math.round(d.expected * f), low: Math.round(d.low * f), high: Math.round(d.high * f) };
    }),
  };
}

export function clampFactor(f: number) {
  return Number.isFinite(f) ? Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, f)) : 1;
}

export type RecipeRow = { menu_item_id: number; ingredient_id: number; qty: number };
// on_hand: expected stock at the start of the day; on_order: coming in on open purchase orders
export type StockRow = { id: number; name: string; unit: string; category: string | null; on_hand: number; on_order: number };
export type PrepNeed = {
  ingredient_id: number;
  name: string;
  unit: string;
  category: string;
  needed: number; // for the expected number of dishes
  needed_busy: number; // if it's as busy as the busiest recent week
  on_hand: number;
  on_order: number;
  short: number; // needed_busy - on_hand - on_order, if positive
  tight: boolean; // short only on a busy day: enough for the expected amount, so not worth a rush order
};

// Ingredients needed for the day: forecast dishes x recipe quantity, compared with stock and open orders.
// Shortfalls use the busy-day amount, so a busy day doesn't run out halfway through dinner.
export function prepNeeds(forecast: Forecast, recipes: RecipeRow[], stock: StockRow[]): PrepNeed[] {
  const byDish = new Map(forecast.dishes.map((d) => [d.id, d]));
  const totals = new Map<number, { needed: number; busy: number }>();
  for (const r of recipes) {
    const dish = byDish.get(r.menu_item_id);
    if (!dish) continue;
    const t = totals.get(r.ingredient_id) ?? { needed: 0, busy: 0 };
    t.needed += Number(r.qty) * dish.expected;
    t.busy += Number(r.qty) * Math.max(dish.high, dish.expected);
    totals.set(r.ingredient_id, t);
  }
  return stock
    .filter((s) => totals.has(s.id))
    .map((s) => {
      const t = totals.get(s.id)!;
      const onHand = Number(s.on_hand);
      const onOrder = Number(s.on_order);
      return {
        ingredient_id: s.id,
        name: s.name,
        unit: s.unit,
        category: s.category ?? "other",
        needed: round1(t.needed),
        needed_busy: round1(t.busy),
        on_hand: round1(onHand),
        on_order: round1(onOrder),
        short: round1(Math.max(0, t.busy - onHand - onOrder)),
        tight: t.busy > onHand + onOrder && t.needed <= onHand + onOrder,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || b.needed - a.needed);
}

// Stock left at the start of `date`: today's stock minus the expected use on each open day from
// tomorrow until the day before. (Today's remaining sales aren't counted: the count is from this morning.)
export function projectStock(currentQty: Map<number, number>, recipes: RecipeRow[], daysBefore: Forecast[]): Map<number, number> {
  const left = new Map(currentQty);
  for (const f of daysBefore) {
    if (f.closed) continue;
    const byDish = new Map(f.dishes.map((d) => [d.id, d.expected]));
    for (const r of recipes) {
      const n = byDish.get(r.menu_item_id);
      if (n && left.has(r.ingredient_id)) left.set(r.ingredient_id, Math.max(0, left.get(r.ingredient_id)! - Number(r.qty) * n));
    }
  }
  return left;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
