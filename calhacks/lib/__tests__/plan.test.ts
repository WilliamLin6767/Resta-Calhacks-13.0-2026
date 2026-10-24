import { describe, expect, it } from "vitest";
import { choiceReason, planOrders, type Offer, type SupplierInfo } from "../purchasing/plan";

// Brisket (3): Bay Area $94 / 15 lb, delivers Mon; Valley $84 / 15 lb, delivers Tue, $400 minimum.
// Bones (1): only Bay Area, $57.20 / 40 lb.
const suppliers: SupplierInfo[] = [
  { id: 2, name: "Bay Area Meat Co.", min_order_amount: 300, earliest_delivery: "2026-10-26" },
  { id: 3, name: "Valley Butcher Supply", min_order_amount: 400, earliest_delivery: "2026-10-27" },
];
const offers: Offer[] = [
  { supplier_id: 2, ingredient_id: 3, pack_desc: "15 lb case", pack_qty: 15, price: 94 },
  { supplier_id: 3, ingredient_id: 3, pack_desc: "15 lb case", pack_qty: 15, price: 84 },
  { supplier_id: 2, ingredient_id: 1, pack_desc: "40 lb case", pack_qty: 40, price: 57.2 },
];
const preferred = new Map([[3, 2], [1, 2]]);
const brisket = (qty: number) => ({ ingredient_id: 3, name: "Brisket", unit: "lb", qty, note: "" });
const bones = (qty: number) => ({ ingredient_id: 1, name: "Beef bones", unit: "lb", qty, note: "" });

describe("planOrders", () => {
  it("picks the cheaper supplier when its order meets the minimum", () => {
    const p = planOrders([brisket(70), bones(120)], offers, suppliers, preferred, null);
    // 70 lb = 5 cases: Valley 5 x 84 = $420 (over its $400 minimum) vs Bay Area $470
    const valley = p.groups.find((g) => g.supplier_id === 3)!;
    expect(valley.total).toBe(420);
    expect(valley.below_minimum).toBe(0);
    expect(p.savings).toBe(50);
  });
  it("moves a small order to a supplier that can take it, instead of missing a minimum", () => {
    const p = planOrders([brisket(30), bones(120)], offers, suppliers, preferred, null);
    // 2 cases from Valley is $168, under $400: brisket joins the Bay Area order
    expect(p.groups.map((g) => g.supplier_id)).toEqual([2]);
    expect(choiceReason(p.groups[0].lines.find((l) => l.ingredient_id === 3)!)).toBe("keeps another supplier's order above its minimum");
  });
  it("only counts suppliers that can deliver in time", () => {
    const p = planOrders([brisket(70)], offers, suppliers, preferred, "2026-10-26");
    expect(p.groups[0].supplier_id).toBe(2); // Valley arrives Tuesday, too late
    expect(choiceReason(p.groups[0].lines[0])).toBe("cheaper suppliers can't deliver in time");
  });
  it("keeps an order under its minimum when nothing else sells the item, and says so", () => {
    const p = planOrders([bones(40)], offers, suppliers, preferred, null);
    expect(p.groups[0]).toMatchObject({ supplier_id: 2, total: 57.2, below_minimum: 242.8 });
  });
  it("lists items no supplier sells", () => {
    const p = planOrders([{ ingredient_id: 99, name: "Oxtail", unit: "lb", qty: 10, note: "" }], offers, suppliers, preferred, null);
    expect(p.cant_order.map((n) => n.name)).toEqual(["Oxtail"]);
  });
});
