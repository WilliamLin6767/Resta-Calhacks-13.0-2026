import { describe, expect, it } from "vitest";
import { countDays, countGap, reorderQty, stockLines, toUnits, usageByDay } from "../inventory/stock";

// Pho Tai uses 0.75 lb of bones a bowl. 20 bowls on Oct 20, 10 on Oct 21.
const sales = [
  { day: "2026-10-20", menu_item_id: 1, units: 20 },
  { day: "2026-10-21", menu_item_id: 1, units: 10 },
];
const recipes = [{ menu_item_id: 1, ingredient_id: 1, qty: 0.75 }];
const bones = { id: 1, name: "Beef bones", unit: "lb", category: "protein", current_qty: 60, par_level: 200, reorder_point: 80 };

describe("stockLines", () => {
  const usage = usageByDay(sales, recipes);
  it("subtracts what sales used on and after the count day", () => {
    const [line] = stockLines([bones], new Map([[1, { day: "2026-10-21", sales_from: "2026-10-21" }]]), usage);
    expect(line).toMatchObject({ used_since: 7.5, estimated: 52.5, daily_use: 11.3, status: "low" });
    expect(line.days_left).toBe(4.6);
  });
  it("uses nothing when the count is newer than the sales", () => {
    expect(stockLines([bones], new Map([[1, { day: "2026-10-22", sales_from: "2026-10-22" }]]), usage)[0].estimated).toBe(60);
  });
  it("orders back up to par", () => {
    expect(reorderQty(stockLines([bones], new Map([[1, { day: "2026-10-22", sales_from: "2026-10-22" }]]), usage)[0])).toBe(140);
  });
});

describe("countDays", () => {
  it("a morning count still has that day's sales to come", () => {
    expect(countDays("2026-10-22T16:00:00Z")).toEqual({ day: "2026-10-22", sales_from: "2026-10-22" }); // 9am Pacific
  });
  it("an evening count already includes that day", () => {
    expect(countDays("2026-10-23T00:59:00Z")).toEqual({ day: "2026-10-22", sales_from: "2026-10-23" }); // 5:59pm Pacific
  });
});

describe("counts", () => {
  it("notices a real gap, not counting noise", () => {
    expect(countGap(52.5, 44)).toEqual({ change: -8.5, pct: -16, notable: true });
    expect(countGap(52.5, 52)).toMatchObject({ notable: false });
  });
  it("turns cases into units", () => {
    expect(toUnits(2, true, 200)).toBe(400); // 2 cases of 200 limes
    expect(toUnits(42, false, 40)).toBe(42);
  });
});
