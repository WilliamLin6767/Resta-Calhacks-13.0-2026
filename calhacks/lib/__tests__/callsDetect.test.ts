import { describe, expect, it } from "vitest";
import { findCandidates, isBlocked, type Facts } from "../calls/detect";

// A small slice of the seed data: Valley Butcher takes phone orders, Bay Area Meat texts,
// Delta Fresh has no phone on file.
function facts(over: Partial<Facts> = {}): Facts {
  return {
    today: "2026-10-23",
    suppliers: [
      { id: 2, name: "Bay Area Meat Co.", contact_name: "Tony", phone: "510-555-0102", preferred_channel: "text", lead_time_days: 1, delivery_days: "Mon,Wed,Fri" },
      { id: 3, name: "Valley Butcher Supply", contact_name: "Maria", phone: "510-555-0103", preferred_channel: "phone", lead_time_days: 2, delivery_days: "Tue,Thu" },
      { id: 4, name: "Delta Fresh Produce", contact_name: null, phone: null, preferred_channel: "phone", lead_time_days: 1, delivery_days: "daily" },
    ],
    ingredients: [
      { id: 10, name: "Brisket", unit: "lb", current_qty: 8, reorder_point: 20, par_level: 50, preferred_supplier_id: 3 },
      { id: 11, name: "Tendon", unit: "lb", current_qty: 30, reorder_point: 10, par_level: 30, preferred_supplier_id: 2 },
      { id: 12, name: "Limes", unit: "ea", current_qty: 10, reorder_point: 50, par_level: 200, preferred_supplier_id: 4 },
    ],
    prices: [
      { supplier_id: 3, ingredient_id: 10, pack_qty: 15, pack_desc: "15 lb case", price: 84, effective_date: "2026-10-01" },
      { supplier_id: 2, ingredient_id: 11, pack_qty: 10, pack_desc: "10 lb case", price: 60, effective_date: "2026-08-01" },
      { supplier_id: 2, ingredient_id: 11, pack_qty: 10, pack_desc: "10 lb case", price: 70, effective_date: "2026-10-09" },
    ],
    flags: [
      { id: 100, invoice_id: 7, invoice_number: "BAM-20633", invoice_date: "2026-10-20", supplier_id: 2, kind: "price_up", message: "Tendon up 17%", money_impact: 42, line: { description: "BF TENDON", qty: 4, unit_price: 70 } },
      { id: 101, invoice_id: 7, invoice_number: "BAM-20633", invoice_date: "2026-10-20", supplier_id: 2, kind: "math", message: "Line total off by $3", money_impact: 3, line: null },
      { id: 102, invoice_id: 7, invoice_number: "BAM-20633", invoice_date: "2026-10-20", supplier_id: 2, kind: "cheaper_elsewhere", message: "Valley is cheaper", money_impact: 30, line: null },
    ],
    invoiceLines: [],
    draftOrders: [],
    existing: [],
    ...over,
  };
}

describe("dispute rule", () => {
  it("bundles an invoice's billing errors of $5 or more into one dispute", () => {
    const { candidates } = findCandidates(facts());
    const dispute = candidates.find((c) => c.purpose === "dispute")!;
    expect(dispute).toMatchObject({ context_type: "invoice", context_id: 7, supplier_id: 2 });
    // $3 math error is too small; cheaper_elsewhere isn't a billing error
    expect(dispute.refs.flag_ids).toEqual([100]);
    expect(dispute.limits.min_credit).toBe(42);
  });

  it("without invoice_flags, flags a matched line priced over 5% above the last earlier price", () => {
    const { candidates } = findCandidates(
      facts({
        flags: null,
        invoiceLines: [
          { invoice_id: 7, invoice_number: "BAM-20633", invoice_date: "2026-10-20", supplier_id: 2, ingredient_id: 11, description: "BF TENDON", qty: 4, unit_price: 74 },
          // 1% over the last price: not a dispute
          { invoice_id: 8, invoice_number: "BAM-20700", invoice_date: "2026-10-21", supplier_id: 2, ingredient_id: 11, description: "BF TENDON", qty: 4, unit_price: 70.7 },
        ],
      })
    );
    const disputes = candidates.filter((c) => c.purpose === "dispute");
    expect(disputes).toHaveLength(1);
    expect(disputes[0].context_id).toBe(7);
    expect(disputes[0].limits.min_credit).toBe(16); // (74 - 70) x 4
  });
});

describe("buy rule", () => {
  it("orders up to par in whole packs from a phone-order supplier", () => {
    const buy = findCandidates(facts()).candidates.find((c) => c.purpose === "buy")!;
    expect(buy).toMatchObject({ context_type: "ingredient", context_id: 10, supplier_id: 3, contact_name: "Maria" });
    // needs 50 - 8 = 42 lb; 15 lb cases -> 3 packs
    expect(buy.limits.max_packs).toBe(3);
    expect(buy.limits.max_total).toBe(277.2); // 3 x $84 x 1.1
    expect(buy.wanted_by).toBe("2026-10-27"); // Fri + 2 days -> next Tue
  });

  it("attaches to a draft order that already covers the item", () => {
    const buy = findCandidates(facts({ draftOrders: [{ id: 55, supplier_id: 3, lines: [{ ingredient_id: 10, qty: 3 }] }] })).candidates.find((c) => c.purpose === "buy")!;
    expect(buy).toMatchObject({ context_type: "purchase_order", context_id: 55 });
    expect(buy.refs.purchase_order_id).toBe(55);
  });
});

describe("info rule", () => {
  it("asks about a price up more than 10% in 30 days", () => {
    const info = findCandidates(facts()).candidates.find((c) => c.purpose === "info" && c.context_id === 11);
    expect(info?.supplier_id).toBe(2);
    expect(JSON.stringify(info?.facts)).toContain("up 17%");
  });

  it("never proposes special requests", () => {
    expect(findCandidates(facts()).candidates.some((c) => (c.purpose as string) === "special_request")).toBe(false);
  });
});

describe("phone numbers and dedupe", () => {
  it("lists suppliers with no phone separately", () => {
    const { candidates, noPhone } = findCandidates(facts());
    expect(candidates.some((c) => c.supplier_id === 4)).toBe(false);
    expect(noPhone).toEqual([expect.objectContaining({ supplier_name: "Delta Fresh Produce" })]);
  });

  it("skips a record with an open request, or one rejected in the last 7 days", () => {
    const open = findCandidates(facts({ existing: [{ context_type: "invoice", context_id: 7, status: "pending", created_at: "2026-10-01T00:00:00Z" }] }));
    expect(open.candidates.some((c) => c.context_id === 7 && c.context_type === "invoice")).toBe(false);

    expect(isBlocked([{ context_type: "invoice", context_id: 7, status: "rejected", created_at: "2026-10-20T10:00:00Z" }], "invoice", 7, "2026-10-23")).toBe(true);
    expect(isBlocked([{ context_type: "invoice", context_id: 7, status: "rejected", created_at: "2026-10-01T10:00:00Z" }], "invoice", 7, "2026-10-23")).toBe(false);
    expect(isBlocked([{ context_type: "invoice", context_id: 7, status: "completed", created_at: "2026-10-22T10:00:00Z" }], "invoice", 7, "2026-10-23")).toBe(false);
    expect(isBlocked([{ context_type: "ingredient", context_id: 7, status: "calling", created_at: "2026-10-22T10:00:00Z" }], "invoice", 7, "2026-10-23")).toBe(false);
  });

  it("keeps one candidate per record", () => {
    const { candidates } = findCandidates(facts());
    const keys = candidates.map((c) => `${c.context_type}:${c.context_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
