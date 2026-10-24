import { describe, expect, it } from "vitest";
import { checkPayouts, groupBills, payoutDispute, quickbooksCsv, weekStart, type Payout } from "../accounting/reconcile";

// Two DoorDash days in the week of Mon Oct 5, 2026
const daily = [
  { day: "2026-10-05", channel: "doordash", revenue: 400, platform_fees: 100 },
  { day: "2026-10-09", channel: "doordash", revenue: 200, platform_fees: 50 },
  { day: "2026-10-09", channel: "dine_in", revenue: 999, platform_fees: 0 },
];
const payout = (over: Partial<Payout> = {}): Payout => ({
  id: 1, platform: "doordash", period_start: "2026-10-05", period_end: "2026-10-11", paid_on: "2026-10-14",
  gross_sales: 600, fees: 150, adjustments: 0, net_amount: 450, reference: "DO-20261005", note: null, ...over,
});

describe("weekStart", () => {
  it("finds the Monday", () => {
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });
});

describe("checkPayouts", () => {
  it("matches a payout to the week's orders", () => {
    const [c] = checkPayouts(daily, [payout()], "2026-10-23");
    expect(c).toMatchObject({ expected_gross: 600, expected_fees: 150, expected_net: 450, status: "ok", difference: 0 });
  });
  it("explains a short payout", () => {
    const [c] = checkPayouts(daily, [payout({ adjustments: -86.4, net_amount: 363.6, note: "Error charge" })], "2026-10-23");
    expect(c.status).toBe("short");
    expect(c.difference).toBe(-86.4);
    expect(c.message).toContain("an adjustment of -$86.40 (Error charge)");
    expect(payoutDispute(c, "Pho Berkeley")).toContain("$86.40 less");
  });
  it("flags a missing payout only after the grace period", () => {
    expect(checkPayouts(daily, [], "2026-10-23")[0]).toMatchObject({ status: "missing", difference: -450 });
    expect(checkPayouts(daily, [], "2026-10-14")[0].status).toBe("pending");
  });
  it("leaves out a week that isn't over", () => {
    expect(checkPayouts(daily, [], "2026-10-10")).toEqual([]);
  });
});

describe("bills", () => {
  it("groups by due date", () => {
    const bill = (id: number, due: string) => ({ id, invoice_number: null, supplier: "S", invoice_date: "2026-10-01", due_date: due, total: 10, status: "received", disputed: 0 });
    const g = groupBills([bill(1, "2026-10-20"), bill(2, "2026-10-27"), bill(3, "2026-11-20")], "2026-10-23");
    expect([g.overdue, g.due_soon, g.later].map((b) => b.map((x) => x.id))).toEqual([[1], [2], [3]]);
  });
});

describe("quickbooksCsv", () => {
  it("writes QuickBooks' 3-column format, oldest first, without numbers in descriptions", () => {
    const csv = quickbooksCsv([
      { date: "2026-10-14", description: "DoorDash payout", amount: 450 },
      { date: "2026-10-09", description: "Bay Area Meat Co., invoice 20561", amount: -697.6 },
    ]);
    expect(csv).toBe('Date,Description,Amount\r\n10/09/2026,"Bay Area Meat Co., invoice",-697.60\r\n10/14/2026,DoorDash payout,450.00\r\n');
  });
});
