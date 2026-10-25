import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  billingImpact,
  cheaperImpact,
  deliveryImpact,
  menuPriceImpact,
  MIN_WEEKLY_USD,
  payoutImpact,
  priceRiseImpact,
  rankFindings,
  stockoutImpact,
  wasteImpact,
} from "@/lib/attention/impact";
import type { Digest } from "@/lib/analytics";
import type { Item } from "@/lib/attention/types";

const digest = JSON.parse(readFileSync(new URL("./fixtures/digest-30.json", import.meta.url), "utf8")) as Digest;
const brisket = digest.price_changes.find((c) => c.ingredient === "Brisket")!;

describe("finding formulas", () => {
  it("billing errors: the flag's money_impact, high confidence", () => {
    expect(billingImpact(171.6)).toMatchObject({ impact_usd_week: 171.6, confidence: "high" });
  });

  it("supplier price rise: (new - old) x usual weekly quantity, from the fixture's brisket", () => {
    const oldUnit = (brisket.current_unit_cost! * brisket.previous_price!) / brisket.current_price!; // 5.50
    const r = priceRiseImpact(brisket.current_unit_cost!, oldUnit, 30, "lb");
    expect(r.impact_usd_week).toBe(23); // (6.2667 - 5.50) x 30 lb
    expect(r).toMatchObject({ confidence: "high", playbook: "supplier_price_rise" });
    expect(r.basis).toContain("Assumes the same volume");
  });

  it("cheaper supplier: price gap x weekly quantity, with the minimum noted", () => {
    const r = cheaperImpact(brisket.current_unit_cost! - brisket.cheapest_unit_cost!, 30, "lb", 150);
    expect(r.impact_usd_week).toBe(20);
    expect(r.basis).toContain("minimum is $150.00");
  });

  it("menu price and delivery gaps: per period, scaled to a week, medium confidence", () => {
    expect(menuPriceImpact(300, 30)).toMatchObject({ impact_usd_week: 70, confidence: "medium" });
    expect(deliveryImpact(60, 30)).toMatchObject({ impact_usd_week: 14, confidence: "medium" });
  });

  it("stockout risk: dish units a day x margin x days short, nothing when not short", () => {
    const pho = digest.menu.find((m) => m.name === "Pho Dac Biet (house special)")!; // 771 in 30 days, $12.33
    const r = stockoutImpact([{ name: pho.name, unitsPerDay: pho.units / 30, margin: pho.unit_margin! }], 2);
    expect(r.impact_usd_week).toBe(633.76); // 25.7 a day x $12.33 x 2 days
    expect(r).toMatchObject({ confidence: "medium", playbook: "stockout_risk" });
    expect(stockoutImpact([{ name: "x", unitsPerDay: 5, margin: 10 }], 0).impact_usd_week).toBeNull();
    expect(stockoutImpact([], 3).impact_usd_week).toBeNull();
  });

  it("waste is weekly; a missing payout is owed once, checked against orders and the bank", () => {
    expect(wasteImpact(42.5)).toMatchObject({ impact_usd_week: 42.5, confidence: "medium" });
    expect(wasteImpact(42.5).impact_once).toBeUndefined();
    expect(payoutImpact(86.4)).toMatchObject({ impact_usd_week: 86.4, impact_once: true, confidence: "high" });
    expect(payoutImpact(86.4).basis).not.toContain("demo");
  });
});

describe("rankFindings", () => {
  const item = (key: string, level: Item["level"], impact: number | null, confidence: Item["confidence"]) => ({ key, level, impact_usd_week: impact, confidence });

  it("ranks by dollars, then confidence, and hides small ones unless they need a decision", () => {
    const ranked = rankFindings(
      [
        item("waste", "watch", 4.2, "medium"), // under $10, not act: hidden
        item("payout", "act", 86.4, "demo"),
        item("bill", "act", 86.4, "high"),
        item("order", "act", null, "low"), // no figure, but needs a decision
        item("price", "watch", 23, "high"),
        item("tight", "info", null, "low"), // hidden
      ],
      10,
    );
    expect(ranked.map((i) => i.key)).toEqual(["bill", "payout", "price", "order"]);
    expect(MIN_WEEKLY_USD).toBe(10);
  });

  it("keeps the top n", () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`k${i}`, "watch", 100 - i, "high"));
    expect(rankFindings(many, 3).map((i) => i.key)).toEqual(["k0", "k1", "k2"]);
  });
});
