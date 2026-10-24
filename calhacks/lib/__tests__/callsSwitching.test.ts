import { describe, expect, it } from "vitest";
import { canCheckAgain, onFileLeads, switchImpact, type ImpactInput } from "../calls/switching";
import { callIngredient, finishedPriority, needsSwitchCheck, type StoredBrief } from "../calls/types";

// A slice of the seed data: ground pork from Bay Area Meat Co. goes into two dishes.
const input: ImpactInput = {
  ingredient: { id: 9, name: "Ground pork", unit: "lb" },
  stock: { estimated: 6, daily_use: 1.5, days_left: 4 },
  dishNames: ["Bun Thit Nuong (grilled pork)", "Cha Gio (4 egg rolls)"],
  digest: {
    kpis: { cur: { revenue: 60000 } as never },
    menu: [
      { name: "Pho Tai", category: "pho", price: 16, units: 900, prev_units: 850, units_change_pct: 6, revenue: 14400, unit_food_cost: 4, food_cost_pct: 25, unit_margin: 12, gross_profit: 10800, class: "star" },
      { name: "Bun Thit Nuong (grilled pork)", category: "bun", price: 15, units: 300, prev_units: 310, units_change_pct: -3, revenue: 4500, unit_food_cost: 4.5, food_cost_pct: 30, unit_margin: 10.5, gross_profit: 3150, class: "plowhorse" },
      { name: "Cha Gio (4 egg rolls)", category: "appetizer", price: 9, units: 200, prev_units: 190, units_change_pct: 5, revenue: 1800, unit_food_cost: 2, food_cost_pct: 22, unit_margin: 7, gross_profit: 1400, class: "puzzle" },
    ],
    price_changes: [],
  },
  currentSupplier: { id: 2, name: "Bay Area Meat Co." },
  prices: [
    { supplier_id: 2, supplier: "Bay Area Meat Co.", pack_qty: 10, pack_desc: "10 lb", price: 35, effective_date: "2026-08-01" },
    { supplier_id: 2, supplier: "Bay Area Meat Co.", pack_qty: 10, pack_desc: "10 lb", price: 38, effective_date: "2026-08-24" },
    { supplier_id: 3, supplier: "Valley Butcher Supply", pack_qty: 20, pack_desc: "20 lb", price: 70, effective_date: "2026-09-01" },
  ],
};

describe("switchImpact", () => {
  it("adds up the sales and profit of the dishes that use the item", () => {
    const impact = switchImpact(input);
    expect(impact.dishes.map((d) => d.name)).toEqual(["Bun Thit Nuong (grilled pork)", "Cha Gio (4 egg rolls)"]); // biggest first
    expect(impact.revenue_at_risk_30d).toBe(6300);
    expect(impact.share_of_revenue_pct).toBe(10.5);
    expect(impact.gross_profit_at_risk_30d).toBe(4550);
    expect(impact).toMatchObject({ on_hand: 6, daily_use: 1.5, days_left: 4 });
  });

  it("uses the current supplier's latest price and lists other suppliers on file", () => {
    const impact = switchImpact(input);
    expect(impact.current_price).toMatchObject({ per_pack: 38, since: "2026-08-24" });
    expect(impact.on_file_alternatives).toEqual([
      { supplier: "Valley Butcher Supply", per_pack: 70, pack_desc: "20 lb", unit_cost: 3.5, current_unit_cost: 3.8 },
    ]);
  });

  it("doesn't guess when nothing on the menu uses the item", () => {
    const impact = switchImpact({ ...input, dishNames: [] });
    expect(impact).toMatchObject({ revenue_at_risk_30d: 0, gross_profit_at_risk_30d: null });
  });
});

describe("when to check for a new supplier", () => {
  const brief = { refs: { ingredient_id: 9 } } as unknown as StoredBrief;
  const done = { status: "completed" as const, brief, result: { supply_problem: true } };
  const NOW = Date.parse("2026-10-24T12:00:00Z");

  it("checks a finished call that found a supply problem with one ingredient, once", () => {
    expect(callIngredient(done)).toBe(9);
    expect(needsSwitchCheck(done, NOW)).toBe(true);
    expect(needsSwitchCheck({ ...done, result: { supply_problem: false } }, NOW)).toBe(false);
    expect(needsSwitchCheck({ ...done, status: "calling" as const }, NOW)).toBe(false);
    expect(needsSwitchCheck({ ...done, brief: { refs: { invoice_id: 7 } } as unknown as StoredBrief }, NOW)).toBe(false);
    expect(needsSwitchCheck({ ...done, result: { supply_problem: true, switch: { status: "done", checked_at: "2026-10-24T11:59:00Z" } } }, NOW)).toBe(false);
  });

  it("retries a check that was interrupted", () => {
    const checking = (at: string) => ({ ...done, result: { supply_problem: true, switch: { status: "checking" as const, checked_at: at } } });
    expect(needsSwitchCheck(checking("2026-10-24T11:59:00Z"), NOW)).toBe(false);
    expect(needsSwitchCheck(checking("2026-10-24T11:50:00Z"), NOW)).toBe(true);
  });

  it("keeps a call with a suggested switch near the top of the finished list", () => {
    const row = { status: "completed" as const, purpose: "info" as const, brief, completed_at: null, decided_at: null, created_at: "2026-10-24T11:00:00Z" };
    expect(finishedPriority({ ...row, result: { outcome: "resolved", follow_up: "", switch: { status: "done", checked_at: "x", recommend: true } } })).toBe(1);
  });
});

describe("candidates on file", () => {
  const suppliers = [
    { id: 2, name: "Bay Area Meat Co.", phone: "510-555-0102" },
    { id: 3, name: "Valley Butcher Supply", phone: "510-555-0103" },
    { id: 6, name: "Pacific Poultry", phone: null },
  ];
  const prices = [
    { supplier_id: 2, pack_desc: "40 lb case", price: 57.2, effective_date: "2026-10-09" },
    { supplier_id: 3, pack_desc: "40 lb case", price: 50, effective_date: "2026-08-01" },
    { supplier_id: 3, pack_desc: "40 lb case", price: 54, effective_date: "2026-09-23" },
    { supplier_id: 6, pack_desc: "case", price: 40, effective_date: "2026-09-23" },
  ];

  it("lists other suppliers that already sell the item, with their latest price, skipping ones with no phone", () => {
    expect(onFileLeads(suppliers, prices, 2)).toEqual([
      {
        source: "on_file",
        supplier_id: 3,
        company_name: "Valley Butcher Supply",
        phone: "510-555-0103",
        city: null,
        state: null,
        matched_product: "Already a supplier: sells it at $54.00 per 40 lb case (since 2026-09-23)",
      },
    ]);
  });
});

describe("checking suppliers again", () => {
  const brief = { refs: { ingredient_id: 20 } } as unknown as StoredBrief;
  const base = { status: "completed" as const, brief };

  it("is allowed after a check that found nobody, not while one runs or after a call was added", () => {
    expect(canCheckAgain({ ...base, result: { supply_problem: true, switch: { status: "done", checked_at: "x", recommend: false } } })).toBe(true);
    expect(canCheckAgain({ ...base, result: { supply_problem: true, switch: { status: "error", checked_at: "x" } } })).toBe(true);
    expect(canCheckAgain({ ...base, result: { supply_problem: true, switch: { status: "checking", checked_at: "x" } } })).toBe(false);
    expect(canCheckAgain({ ...base, result: { supply_problem: true, switch: { status: "done", checked_at: "x", recommend: true, follow_up_call_id: 12 } } })).toBe(false);
    expect(canCheckAgain({ ...base, result: { supply_problem: false } })).toBe(false);
  });
});
