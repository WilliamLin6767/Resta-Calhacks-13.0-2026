import { describe, expect, it } from "vitest";
import {
  deliveryPlan, dishCosts, menuPriceAtLeast, menuPriceAtMost, suggestPrice, unitCostsAt,
  type Dish, type PriceRow,
} from "../pricing/pricing";

function dish(overrides: Partial<Dish> = {}): Dish {
  return { id: 1, name: "Pho Tai", category: "Pho", price: 15.95, delivery_price: null, units: 800, units_change_pct: 1, class: "star", ...overrides };
}

describe("menu-style prices", () => {
  it("rounds up to .25 / .50 / .75 / .95", () => {
    expect(menuPriceAtLeast(16.23)).toBe(16.25);
    expect(menuPriceAtLeast(18.73)).toBe(18.75);
    expect(menuPriceAtLeast(16.78)).toBe(16.95);
    expect(menuPriceAtLeast(16.96)).toBe(17.25);
    expect(menuPriceAtLeast(16.5)).toBe(16.5);
  });
  it("rounds down for a cap", () => {
    expect(menuPriceAtMost(17.55)).toBe(17.5);
    expect(menuPriceAtMost(17.1)).toBe(16.95);
  });
});

describe("costs", () => {
  // Brisket (ingredient 3): preferred supplier 2 raised it from 82.50 to 94.00 per 15 lb on Oct 9.
  // Supplier 3 quotes 84.00 but isn't preferred.
  const prices: PriceRow[] = [
    { supplier_id: 2, ingredient_id: 3, pack_qty: 15, price: 82.5, effective_date: "2026-08-24" },
    { supplier_id: 2, ingredient_id: 3, pack_qty: 15, price: 94.0, effective_date: "2026-10-09" },
    { supplier_id: 3, ingredient_id: 3, pack_qty: 15, price: 84.0, effective_date: "2026-09-23" },
    { supplier_id: 5, ingredient_id: 30, pack_qty: 10, price: 9.0, effective_date: "2026-10-20" },
  ];
  const ingredients = [{ id: 3, preferred_supplier_id: 2 }, { id: 30, preferred_supplier_id: null }];

  it("uses the preferred supplier's latest price on that date", () => {
    expect(unitCostsAt(prices, ingredients, "2026-10-23").get(3)).toBeCloseTo(94 / 15);
    expect(unitCostsAt(prices, ingredients, "2026-09-30").get(3)).toBeCloseTo(82.5 / 15);
  });
  it("falls back to the earliest price before the first one", () => {
    expect(unitCostsAt(prices, ingredients, "2026-09-30").get(30)).toBeCloseTo(0.9);
  });
  it("adds up a recipe", () => {
    const costs = dishCosts([{ menu_item_id: 2, ingredient_id: 3, qty: 0.12 }, { menu_item_id: 2, ingredient_id: 30, qty: 1 }], unitCostsAt(prices, ingredients, "2026-10-23"));
    expect(costs.get(2)).toBeCloseTo(0.12 * (94 / 15) + 0.9);
  });
});

describe("suggestPrice", () => {
  it("passes a cost rise on, rounded to a menu price", () => {
    // Real seed numbers: Pho Tai went from $4.39 to $4.67 a bowl.
    const s = suggestPrice(dish(), 4.67, 4.39, 0.28, 0.25);
    expect(s.action).toBe("raise");
    expect(s.new_price).toBe(16.25);
    expect(s.reasons[0]).toContain("$4.39 to $4.67");
  });
  it("brings food cost back to the target", () => {
    // Pho Dac Biet: $5.62 on a $17.95 dish is 31%; 30% needs $18.73.
    const s = suggestPrice(dish({ price: 17.95 }), 5.62, 5.62, 0.28, 0.25);
    expect(s.new_price).toBe(18.75);
    expect(s.reasons[0]).toContain("above the 30% target");
  });
  it("leaves a fine dish alone", () => {
    const s = suggestPrice(dish(), 2.4, 2.4, 0.28, 0.25);
    expect(s.action).toBe("ok");
    expect(s.new_price).toBeNull();
    expect(s.extra_profit).toBe(0);
  });
  it("ignores tiny cost changes", () => {
    expect(suggestPrice(dish(), 2.32, 2.28, 0.28, 0.25).action).toBe("ok");
  });
  it("caps a big jump at 10% and says so", () => {
    const s = suggestPrice(dish({ price: 10 }), 5, 2, 0.28, 0.25);
    expect(s.new_price).toBe(10.95);
    expect(s.in_steps).toBe(true);
  });
  it("asks the owner to look first when the dish doesn't sell", () => {
    const s = suggestPrice(dish({ class: "dog" }), 4.67, 4.39, 0.28, 0.25);
    expect(s.action).toBe("review");
    expect(s.new_price).toBe(16.25);
    expect(s.extra_profit).toBe(0);
  });
  it("estimates the extra profit, after the apps' cut on delivery orders", () => {
    // +$0.30 on 800 bowls: 72% in-house keep it all, 28% on the apps keep 75% of it.
    const s = suggestPrice(dish(), 4.67, 4.39, 0.28, 0.25);
    expect(s.extra_profit).toBeCloseTo(800 * 0.3 * (0.72 + 0.28 * 0.75), 1);
  });
});

describe("deliveryPlan", () => {
  it("suggests about 20% more on the apps", () => {
    const plan = deliveryPlan([dish()], 0.28, 0.25);
    expect(plan.prices).toEqual([{ menu_item_id: 1, name: "Pho Tai", price: 15.95, delivery_price: 15.95, new_delivery_price: 19.25 }]);
    expect(plan.fee_pct).toBe(25);
  });
  it("skips dishes already priced up, and restaurants without delivery fees", () => {
    expect(deliveryPlan([dish({ delivery_price: 19.25 })], 0.28, 0.25).prices).toEqual([]);
    expect(deliveryPlan([dish()], 0.28, 0).prices).toEqual([]);
  });
});
