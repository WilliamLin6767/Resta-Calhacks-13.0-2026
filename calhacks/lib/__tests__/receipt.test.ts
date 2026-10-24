import { describe, expect, it } from "vitest";
import { checkReceipt, ingredientUse, stockImpact } from "../sales/receipt";

const menu = [{ id: 1, name: "Pho Tai (rare beef)", price: 15.95 }, { id: 8, name: "Cha Gio (4 egg rolls)", price: 8.95 }];
const recipes = [
  { menu_item_id: 1, ingredient_id: 1, qty: 0.75 }, // bones
  { menu_item_id: 1, ingredient_id: 17, qty: 0.15 }, // bean sprouts
  { menu_item_id: 8, ingredient_id: 16, qty: 4 }, // egg roll wrappers
];

describe("checkReceipt", () => {
  it("is quiet when the receipt matches the menu", () => {
    const lines = [{ printed: "2 PHO TAI", menu_item_id: 1, qty: 2, unit_price: 15.95, line_total: 31.9 }];
    expect(checkReceipt(lines, menu, 31.9)).toEqual([]);
  });
  it("points out unmatched lines, odd prices and totals that don't add up", () => {
    const notes = checkReceipt(
      [
        { printed: "1 PHO TAI", menu_item_id: 1, qty: 1, unit_price: 12, line_total: 12 },
        { printed: "1 MYSTERY", menu_item_id: 0, qty: 1, unit_price: 5, line_total: 5 },
      ],
      menu,
      20,
    );
    expect(notes).toEqual([
      "Pho Tai (rare beef) was charged $12.00; the menu says $15.95.",
      '"1 MYSTERY" isn\'t matched to a dish yet.',
      "The lines add up to $17.00, but the subtotal says $20.00.",
    ]);
  });
});

describe("what a receipt uses", () => {
  it("multiplies dishes by recipes", () => {
    const use = ingredientUse([{ menu_item_id: 1, qty: 2 }, { menu_item_id: 8, qty: 2 }], recipes);
    expect(Object.fromEntries(use)).toEqual({ 1: 1.5, 17: 0.3, 16: 8 });
  });
  it("lists what became low first", () => {
    const before = [
      { id: 1, name: "Beef bones", unit: "lb", estimated: 60, status: "low" as const, days_left: 1.1 },
      { id: 17, name: "Bean sprouts", unit: "lb", estimated: 12.2, status: "ok" as const, days_left: 0.9 },
    ];
    const after = [
      { id: 1, name: "Beef bones", unit: "lb", estimated: 58.5, status: "low" as const, days_left: 1.1 },
      { id: 17, name: "Bean sprouts", unit: "lb", estimated: 11.9, status: "low" as const, days_left: 0.9 },
    ];
    expect(stockImpact(before, after).map((i) => [i.name, i.used, i.status_after])).toEqual([
      ["Bean sprouts", 0.3, "low"],
      ["Beef bones", 1.5, "low"],
    ]);
  });
});
