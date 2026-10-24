import { describe, expect, it } from "vitest";
import type { PayoutCheck } from "../accounting/reconcile";
import { bankChecks, bankNote, cashAfterBills, orderImpact } from "../bank/match";

// One DoorDash week: orders say $1,200 is owed after fees
function week(over: Partial<PayoutCheck> = {}, payout: Partial<NonNullable<PayoutCheck["payout"]>> | null = {}): PayoutCheck {
  return {
    platform: "doordash", period_start: "2026-10-05", period_end: "2026-10-11",
    expected_gross: 1600, expected_fees: 400, expected_net: 1200, difference: 0, status: "ok", message: "Matches your orders.",
    payout: payout === null ? null : {
      id: 7, platform: "doordash", period_start: "2026-10-05", period_end: "2026-10-11", paid_on: "2026-10-14",
      gross_sales: 1600, fees: 400, adjustments: 0, net_amount: 1200, reference: "DO-20261005", note: null, ...payout,
    },
    ...over,
  };
}
const deposit = (amount: number, extra: Partial<{ id: string; payout_id: number | null; date: string; description: string }> = {}) => ({
  id: "d1", payout_id: null, date: "2026-10-14", amount, description: "DoorDash payout DO-20261005", ...extra,
});

describe("bankChecks", () => {
  it("matches when orders, statement and bank agree (the bank keeps whole dollars)", () => {
    const [c] = bankChecks([week({}, { net_amount: 1200.4 })], [deposit(1200)]);
    expect(c.status).toBe("matched");
    expect(c.shortfall).toBe(0);
  });
  it("catches money the statement reports but the bank never got", () => {
    const [c] = bankChecks([week()], [deposit(1080)]);
    expect(c).toMatchObject({ status: "bank_short", shortfall: 120 });
    expect(c.message).toContain("$120.00 missing");
    expect(bankNote(c, "Pho Berkeley", "4417")).toContain("account ending 4417");
  });
  it("says when no deposit arrived at all", () => {
    const [c] = bankChecks([week()], []);
    expect(c).toMatchObject({ status: "no_deposit", shortfall: 1200 });
  });
  it("keeps the app's own short payment separate from the bank", () => {
    const [c] = bankChecks([week({ status: "short", difference: -86.4 }, { net_amount: 1113.6 })], [deposit(1113)]);
    expect(c).toMatchObject({ status: "app_paid_short", shortfall: 86.4 });
  });
  it("finds a deposit by amount and date when the description doesn't say which payout it is", () => {
    const [c] = bankChecks([week()], [deposit(1200, { description: "ACH credit" })]);
    expect(c.status).toBe("matched");
  });
  it("uses each deposit once", () => {
    const two = [week(), week({ period_start: "2026-10-12", period_end: "2026-10-18" }, { id: 8, paid_on: "2026-10-21", reference: "DO-20261012" })];
    const res = bankChecks(two, [deposit(1200)]);
    expect(res.map((r) => r.status)).toEqual(["matched", "no_deposit"]);
  });
});

describe("cash", () => {
  it("is what's in the bank minus bills due, compared with the reserve", () => {
    const cash = cashAfterBills(2752, 152, 1000);
    expect(cash).toMatchObject({ after_bills: 2600, spare: 1600 });
  });
  it("shows how far an order would dip below the reserve", () => {
    const cash = cashAfterBills(1752, 152, 1000); // 1,600 left after bills
    expect(orderImpact(cash, 650)).toEqual({ left: 950, below_reserve: 50 });
    expect(orderImpact(cash, 400)).toEqual({ left: 1200, below_reserve: 0 });
  });
});
