import { describe, expect, it } from "vitest";
import { cashForecast, dailySpend, expectedPayouts, foodBudget, savingsMove } from "../bank/forecast";

const NAMES = { doordash: "DoorDash", ubereats: "Uber Eats" };
const TODAY = "2026-10-24";

// Like the demo: $1,752 now, a $152 bill on Tuesday, DoorDash pays $2,000 on Wednesday
function demo(over: Partial<Parameters<typeof cashForecast>[0]> = {}) {
  return cashForecast({
    today: TODAY, balance: 1752, reserve: 1000,
    payouts: [{ date: "2026-10-28", label: "DoorDash payout (estimate)", amount: 2000 }],
    bills: [{ date: "2026-10-27", label: "Pacific bill", amount: 152 }],
    orders: [{ date: null, label: "Bay order", amount: 400 }],
    daily_spend: 50,
    ...over,
  });
}

describe("expectedPayouts", () => {
  it("expects each app a week after its last payout, at the average of its last 4", () => {
    const past = [
      { platform: "doordash", paid_on: "2026-10-21", net_amount: 1700 },
      { platform: "doordash", paid_on: "2026-10-14", net_amount: 2100 },
      { platform: "doordash", paid_on: "2026-10-07", net_amount: 2000 },
      { platform: "doordash", paid_on: "2026-09-30", net_amount: 2200 },
      { platform: "doordash", paid_on: "2026-09-23", net_amount: 9999 }, // older than the last 4
    ];
    const flows = expectedPayouts(past, TODAY, NAMES);
    expect(flows.map((f) => f.date)).toEqual(["2026-10-28", "2026-11-04"]);
    expect(flows[0]).toMatchObject({ amount: 2000, label: "DoorDash payout (estimate)" });
  });
  it("doesn't count on a payout that is already late", () => {
    const flows = expectedPayouts([{ platform: "ubereats", paid_on: "2026-10-14", net_amount: 1300 }], TODAY, NAMES);
    expect(flows.map((f) => f.date)).toEqual(["2026-10-28", "2026-11-04"]); // Oct 21 never came
  });
});

describe("cashForecast", () => {
  it("finds the lowest day and the first day under the reserve", () => {
    const f = demo();
    expect(f.days).toHaveLength(14);
    // 1,752 - 400 (order today) - 4 days x 50 - 152 (bill) = 1,000 on Tuesday
    expect(f.days[3]).toMatchObject({ date: "2026-10-27", balance: 1000 });
    expect(f.lowest).toEqual({ date: "2026-10-27", balance: 1000 });
    expect(f.first_below).toBeNull(); // exactly at the reserve is not below it
    expect(demo({ reserve: 1001 }).first_below).toBe("2026-10-27");
  });
  it("puts overdue bills and undated orders on today", () => {
    const f = demo({ bills: [{ date: "2026-10-01", label: "Old bill", amount: 100 }] });
    expect(f.days[0].events.map((e) => e.label)).toEqual(["Old bill", "Bay order"]);
  });
  it("adds up money in and out", () => {
    const f = demo();
    expect(f.money_in).toBe(2000);
    expect(f.money_out).toBe(400 + 152 + 14 * 50);
  });
});

describe("savingsMove", () => {
  it("suggests what the lowest day has above the reserve, less a 20% cushion, in $50 steps", () => {
    const m = savingsMove(demo({ reserve: 500 })); // lowest 1,000: 500 spare, 400 after the cushion
    expect(m).toEqual({ kind: "now", amount: 400, lowest_after: 600 });
  });
  it("waits for the next payout when cash is tight before it", () => {
    const m = savingsMove(demo()); // lowest is right at the reserve until Wednesday's payout
    expect(m.kind).toBe("later");
    if (m.kind === "later") {
      expect(m.date).toBe("2026-10-28");
      // From Wednesday on the lowest is the last day: 1,000 + 2,000 - 50 x 10 = 2,500, so 1,500 spare
      expect(m.amount).toBe(1200);
    }
  });
  it("suggests nothing when there's nothing spare", () => {
    expect(savingsMove(demo({ payouts: [], reserve: 1200 }))).toEqual({ kind: "none" });
  });
});

describe("dailySpend", () => {
  it("averages the last 6 weeks of invoices", () => {
    const invoices = [
      { invoice_date: "2026-10-20", total: 420 },
      { invoice_date: "2026-09-20", total: 420 },
      { invoice_date: "2026-08-01", total: 9999 }, // too old
    ];
    expect(dailySpend(invoices, TODAY)).toBe(20);
  });
});

describe("foodBudget", () => {
  it("compares food used with the target share of sales", () => {
    const b = foodBudget({
      days: 30, sales: 60000, food_cost: 13500, target: 0.3,
      dishes: [{ name: "Pho Tai", food_cost: 3600 }, { name: "Pho Ga", food_cost: 2000 }, { name: "Banh Mi", food_cost: 900 }, { name: "Tea", food_cost: 50 }],
    });
    expect(b).toMatchObject({ budget: 18000, used: 13500, pct: 22.5, left: 4500, target_pct: 30 });
    expect(b.top.map((t) => [t.name, t.share])).toEqual([["Pho Tai", 27], ["Pho Ga", 15], ["Banh Mi", 7]]);
  });
  it("goes negative when over budget", () => {
    expect(foodBudget({ days: 30, sales: 10000, food_cost: 3500, target: 0.3, dishes: [] }).left).toBe(-500);
  });
});
