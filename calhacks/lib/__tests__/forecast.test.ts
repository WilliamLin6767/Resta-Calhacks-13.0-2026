import { describe, expect, it } from "vitest";
import { adjustForecast, forecastDay, prepNeeds, projectStock, type SalesRow } from "../prep/forecast";

const pho = { id: 1, name: "Pho Tai" };
// Four Saturdays (oldest first: 27, 37, 36, 36 bowls) and one Friday. Oct 24 2026 is a Saturday.
const rows: SalesRow[] = [
  { day: "2026-09-26", menu_item_id: 1, units: 27 },
  { day: "2026-10-03", menu_item_id: 1, units: 37 },
  { day: "2026-10-10", menu_item_id: 1, units: 36 },
  { day: "2026-10-17", menu_item_id: 1, units: 36 },
  { day: "2026-10-23", menu_item_id: 1, units: 20 },
];

describe("forecastDay", () => {
  it("weights recent same-weekdays more", () => {
    const f = forecastDay(rows, [pho], "2026-10-24");
    expect(f.weekday).toBe("Saturday");
    expect(f.days_used).toEqual(["2026-10-17", "2026-10-10", "2026-10-03", "2026-09-26"]);
    // (36*4 + 36*3 + 37*2 + 27*1) / 10 = 35.3
    expect(f.dishes[0]).toMatchObject({ expected: 35, low: 27, high: 37, history: [27, 37, 36, 36] });
  });
  it("knows a weekday with no sales is a closed day", () => {
    expect(forecastDay(rows, [pho], "2026-10-27").closed).toBe(true); // Tuesday
  });
  it("is unsure with little history", () => {
    expect(forecastDay(rows.slice(3), [pho], "2026-10-24").dishes[0].confidence).toBe("low");
  });
  it("lets the AI scale a dish, but only within limits", () => {
    const f = forecastDay(rows, [pho], "2026-10-24");
    expect(adjustForecast(f, { 1: 1.2 }).dishes[0].expected).toBe(42);
    expect(adjustForecast(f, { 1: 10 }).dishes[0].expected).toBe(70); // capped at 2x
  });
});

describe("prepNeeds", () => {
  const recipes = [{ menu_item_id: 1, ingredient_id: 2, qty: 0.25 }];
  it("multiplies dishes by recipe and finds what's short on a busy day", () => {
    const f = forecastDay(rows, [pho], "2026-10-24");
    const [need] = prepNeeds(f, recipes, [{ id: 2, name: "Eye of round", unit: "lb", category: "protein", on_hand: 5, on_order: 2 }]);
    expect(need).toMatchObject({ needed: 8.8, needed_busy: 9.3, short: 2.3, tight: false }); // 37 x 0.25 = 9.25, minus 5 on hand and 2 on order
  });
  it("calls it tight when only a busy day would run out", () => {
    const f = forecastDay(rows, [pho], "2026-10-24");
    const [need] = prepNeeds(f, recipes, [{ id: 2, name: "Eye of round", unit: "lb", category: "protein", on_hand: 9, on_order: 0 }]);
    expect(need).toMatchObject({ short: 0.3, tight: true });
  });
  it("subtracts what the days before will use", () => {
    const friday = forecastDay(rows, [pho], "2026-10-30");
    const left = projectStock(new Map([[2, 20]]), recipes, [friday]);
    expect(left.get(2)).toBe(20 - 0.25 * friday.dishes[0].expected);
  });
});
