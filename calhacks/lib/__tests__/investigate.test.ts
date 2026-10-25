import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  campaignOptions,
  daypartOf,
  dishStockUnits,
  forecastIngredientUse,
  ingredientCost,
  maxDiscount,
  profitOpportunities,
  restockOptions,
  type FlagRow,
} from "@/lib/agent/investigate";
import type { Digest } from "@/lib/analytics";
import type { StockLine } from "@/lib/inventory/stock";
import type { Suggestion } from "@/lib/pricing/pricing";
import { planOrders } from "@/lib/purchasing/plan";

const digest = JSON.parse(readFileSync(new URL("./fixtures/digest-30.json", import.meta.url), "utf8")) as Digest;

const flag = (over: Partial<FlagRow>): FlagRow => ({
  id: 1, invoice_id: 12, invoice_number: "BAM-20702", supplier: "Bay Area Meat Co.", ingredient_id: 4,
  kind: "overcharge", message: "Brisket billed at $94.00, agreed $82.50", money_impact: 171, resolved: false, ...over,
});

describe("profitOpportunities", () => {
  const raise: Suggestion = {
    dish: { id: 2, name: "Pho Tai (rare beef)", category: "Pho", price: 15.95, delivery_price: null, units: 300, units_change_pct: null, class: "star" },
    cost_now: 4.9, cost_before: 4.6, cost_change_pct: 6.5, food_cost_pct: 30.7, action: "raise", new_price: 16.95, reasons: [], in_steps: false, extra_profit: 300,
  };
  const list = profitOpportunities({
    days: 30,
    suggestions: [raise, { ...raise, dish: { ...raise.dish, name: "Pho Ga" }, action: "ok", new_price: null }],
    delivery: { fee_pct: 25, share_pct: 28, prices: [{ menu_item_id: 1, name: "Pho Tai", price: 15.95, delivery_price: 15.95, new_delivery_price: 18.95 }], extra_profit: 60 },
    flags: [flag({}), flag({ id: 2, resolved: true }), flag({ id: 3, kind: "price_up", money_impact: 40 })],
    wasteWeek: 42.5,
    menu: digest.menu,
    marginThreshold: digest.menu_thresholds.margin_threshold,
    priceChanges: digest.price_changes,
    weeklyUse: new Map([["brisket", { qty: 30, unit: "lb" }]]),
  });

  it("works out every figure in code and sorts by dollars", () => {
    expect(list.map((o) => [o.kind, o.amount_usd, o.per])).toEqual([
      ["billing_error", 171, "once"],
      ["price_raise", 70, "week"], // $300 a month -> per week
      ["waste", 42.5, "week"],
      ["cheaper_supplier", 20, "week"], // (6.2667 - 5.60) x 30 lb
      ["delivery_price", 14, "week"],
    ]);
  });

  it("explains each figure, and skips resolved flags, price-ups and 'ok' dishes", () => {
    const cheaper = list.find((o) => o.kind === "cheaper_supplier")!;
    expect(cheaper.title).toBe("Buy Brisket from Valley Butcher Supply instead of Bay Area Meat Co.");
    expect(cheaper.basis).toContain("x 30 lb used a week");
    expect(list.find((o) => o.kind === "price_raise")!.basis).toContain("Assumes the same number sell");
    expect(list.filter((o) => o.kind === "billing_error")).toHaveLength(1);
  });

  it("lists a popular dish only when its food cost is over target, never a cheap item with a normal cost", () => {
    expect(list.some((o) => o.kind === "low_margin")).toBe(false); // the fixture's plowhorses are cheap, not costly
    const costly = { ...digest.menu.find((m) => m.class === "plowhorse")!, name: "Goi Cuon", price: 8.5, unit_food_cost: 3.4, food_cost_pct: 40, units: 300 };
    const more = profitOpportunities({ days: 30, suggestions: [], delivery: { fee_pct: 25, share_pct: 0, prices: [], extra_profit: 0 }, flags: [], wasteWeek: 0, menu: [costly], marginThreshold: 10, priceChanges: [], weeklyUse: new Map() });
    expect(more).toHaveLength(1);
    expect(more[0].amount_usd).toBe(59.5); // (3.40 - 0.30 x 8.50) x 300 / 30 x 7
  });
});

describe("ingredientCost", () => {
  const r = ingredientCost({
    ingredient: { id: 4, name: "Brisket", unit: "lb" },
    preferredSupplierId: 2,
    prices: [
      { supplier_id: 2, supplier: "Bay Area Meat Co.", pack_desc: "15 lb case", pack_qty: 15, price: 82.5, effective_date: "2026-09-01" },
      { supplier_id: 2, supplier: "Bay Area Meat Co.", pack_desc: "15 lb case", pack_qty: 15, price: 94, effective_date: "2026-10-09" },
      { supplier_id: 3, supplier: "Valley Butcher Supply", pack_desc: "15 lb case", pack_qty: 15, price: 84, effective_date: "2026-10-01" },
    ],
    invoiceLines: [],
    flags: [flag({}), flag({ id: 9, resolved: true })],
    market: null,
    calls: [{ id: 5, title: "Ask Bay Area Meat about brisket", status: "completed", outcome: "no change", created_at: "2026-10-15" }],
    recipes: [{ menu_item_id: 1, qty: 0.25 }],
    dishes: [{ id: 1, name: "Pho Dac Biet (house special)" }],
    menu: digest.menu,
    days: 30,
    weeklyUse: 30,
  });

  it("finds the rise and what it adds a week", () => {
    expect(r.current).toMatchObject({ supplier: "Bay Area Meat Co.", price: 94, unit_cost: 6.27 });
    expect(r.before).toMatchObject({ price: 82.5, unit_cost: 5.5 });
    expect(r.change_pct).toBe(13.9);
    expect(r.weekly_cost_rise).toBe(23); // (6.2667 - 5.50) x 30 lb
  });

  it("compares the other suppliers and the dishes it hits", () => {
    expect(r.alternatives).toEqual([expect.objectContaining({ supplier: "Valley Butcher Supply", unit_cost: 5.6, cheaper_by_per_unit: 0.67, weekly_saving: 20 })]);
    expect(r.dishes_affected).toEqual([expect.objectContaining({ dish: "Pho Dac Biet (house special)", cost_change_per_plate: 0.19, weekly_margin_change: -34.48 })]);
    expect(r.open_flags.map((f) => f.id)).toEqual([1]);
    expect(r.past_calls).toHaveLength(1);
  });
});

describe("restockOptions", () => {
  // Four past Saturdays and Sundays of one dish that uses 0.5 lb of chicken
  const sales = ["2026-10-17", "2026-10-10", "2026-10-03", "2026-09-26"].flatMap((sat) => {
    const sun = new Date(Date.parse(`${sat}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    return [{ day: sat, menu_item_id: 7, units: 40 }, { day: sun, menu_item_id: 7, units: 20 }];
  });
  const dishes = [{ id: 7, name: "Pho Ga" }];
  const recipes = [{ menu_item_id: 7, ingredient_id: 3, qty: 0.5 }];

  it("forecasts the ingredient from the dish forecast, closed days at zero", () => {
    const f = forecastIngredientUse(sales, dishes, recipes, 3, "2026-10-24"); // a Saturday
    expect(f.byDay[0]).toEqual({ date: "2026-10-24", use: 20, closed: false });
    expect(f.byDay[1]).toEqual({ date: "2026-10-25", use: 10, closed: false });
    expect(f.byDay[2].closed).toBe(true); // no Monday sales in the history
    expect(f.total).toBe(30);
  });

  it("orders the larger of par and the forecast, with the plan's packs and the cash left", () => {
    const line: StockLine = { id: 3, name: "Chicken", unit: "lb", category: "Meat", current_qty: 12, par_level: 20, reorder_point: 10, last_counted: "2026-10-23", used_since: 0, estimated: 12, daily_use: 4, days_left: 3, status: "low" };
    const forecast = forecastIngredientUse(sales, dishes, recipes, 3, "2026-10-24");
    const qty = Math.max(8, forecast.total - line.estimated); // 18
    const plan = planOrders(
      [{ ingredient_id: 3, name: "Chicken", unit: "lb", qty, note: `${qty} lb` }],
      [{ supplier_id: 1, ingredient_id: 3, pack_desc: "10 lb case", pack_qty: 10, price: 40 }, { supplier_id: 2, ingredient_id: 3, pack_desc: "40 lb case", pack_qty: 40, price: 140 }],
      [{ id: 1, name: "Delta", min_order_amount: 50, earliest_delivery: "2026-10-26" }, { id: 2, name: "Sysco", min_order_amount: 0, earliest_delivery: "2026-10-27" }],
      new Map([[3, 1]]),
      null,
    );
    const r = restockOptions({ line, forecast, plan, cash: { start: 5000, reserve: 4000, lowest: { date: "2026-10-30", balance: 4050 } } });
    expect(r.needed).toBe(18);
    expect(r.runs_out_on).toBe("2026-10-24"); // 12 lb on hand, 20 lb used today
    expect(r.options[0]).toMatchObject({ supplier: "Delta", packs: 2, cost: 80 });
    expect(r.cash).toEqual({ now: 5000, after_order: 4920, reserve: 4000, lowest_in_14_days_after_order: 3970, stays_above_reserve: false });
  });
});

describe("campaignOptions", () => {
  const dishes = [
    { id: 1, name: "Bun Bo Hue", category: "Noodles", price: 16.5 },
    { id: 2, name: "Com Tam Suon", category: "Rice", price: 16.95 },
    { id: 3, name: "Banh Mi", category: "Sandwiches", price: 10.5 },
    { id: 9, name: "Ca Phe Sua Da", category: "Drinks", price: 6 },
  ];
  const menu = [
    { ...digest.menu[0], name: "Bun Bo Hue", unit_margin: 12.85, unit_food_cost: 3.65, food_cost_pct: 22.1 },
    { ...digest.menu[0], name: "Com Tam Suon", unit_margin: 14.55, unit_food_cost: 2.4, food_cost_pct: 14.2 },
    { ...digest.menu[0], name: "Banh Mi", unit_margin: 8.74, unit_food_cost: 1.76, food_cost_pct: 16.8 },
    { ...digest.menu[0], name: "Ca Phe Sua Da", unit_margin: 5.4, unit_food_cost: 0.6, food_cost_pct: 10 },
  ];
  // Lunch orders of Bun Bo Hue fell from 40 to 20; Com Tam held steady at 30.
  const lunch = (daysAgo: number) => new Date(Date.parse("2026-10-24T19:30:00Z") - daysAgo * 86400_000).toISOString(); // 12:30 Pacific
  const sales = [
    { menu_item_id: 1, ordered_at: lunch(20), qty: 40 },
    { menu_item_id: 1, ordered_at: lunch(5), qty: 20 },
    { menu_item_id: 2, ordered_at: lunch(20), qty: 30 },
    { menu_item_id: 2, ordered_at: lunch(5), qty: 30 },
  ];
  const r = campaignOptions({
    days: 14,
    daypart: "lunch",
    now: "2026-10-24T22:00:00Z",
    dishes,
    menu,
    sales,
    stockUnits: new Map([[1, 200], [2, 200], [3, 5]]),
    forecastWeek: new Map([[1, 50], [2, 50], [3, 40]]),
    lastPosted: new Map([["com tam suon", "2026-10-20T18:00:00Z"]]),
    trends: [{ dish_name: "Bun Rieu", recommend_score: 0.9 }, { dish_name: "Banh Mi", recommend_score: 0.8 }],
  });

  it("ranks the dish whose lunch dipped, and skips what stock can't cover or was just posted", () => {
    expect(r.candidates.map((c) => c.dish)).toEqual(["Bun Bo Hue"]); // Com Tam posted 4 days ago; Banh Mi stock covers 5 of 52
    const top = r.candidates[0];
    expect(top.daypart_change_pct).toBe(-50);
    expect(top.weekly_margin_lost).toBe(128.5); // 20 lunch plates lost x $12.85 over 14 days, per week
    expect(top.promo_week_units).toBe(65); // 50 x 1.3, labeled as an assumption
    expect(top.promo_week_basis).toContain("assumed lift");
  });

  it("allows a drink bundle and a discount only within the food-cost target", () => {
    expect(r.candidates[0].offers.map((o) => o.kind)).toEqual(["feature", "drink_bundle", "discount"]);
    expect(maxDiscount(16.5, 3.65)).toBe(2); // capped at $2
    expect(maxDiscount(10, 2.85)).toBe(0.5); // 10 - 2.85 / 0.3 = 0.50
    expect(maxDiscount(8, 2.7)).toBe(0); // already over target
    expect(r.trend_dishes_not_on_menu.map((t) => t.dish_name)).toEqual(["Bun Rieu"]);
  });

  it("counts how many plates stock can make from the scarcest ingredient", () => {
    const units = dishStockUnits([{ menu_item_id: 1, ingredient_id: 1, qty: 0.5 }, { menu_item_id: 1, ingredient_id: 2, qty: 2 }], new Map([[1, 10], [2, 10]]));
    expect(units.get(1)).toBe(5);
  });
});

describe("daypartOf", () => {
  it("uses Pacific time", () => {
    expect(daypartOf("2026-10-20T19:30:00Z")).toBe("lunch"); // 12:30 PDT
    expect(daypartOf("2026-10-21T01:00:00Z")).toBe("dinner"); // 18:00 PDT
    expect(daypartOf("2026-10-20T23:00:00Z")).toBeNull(); // 16:00
    expect(daypartOf("2026-12-02T20:00:00Z")).toBe("lunch"); // 12:00 PST
  });
});
