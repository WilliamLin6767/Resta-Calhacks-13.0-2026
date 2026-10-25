// Dollars per week for a finding, in code (pure). One function per kind of finding, each with
// the formula written into its basis. No defensible formula, no figure: impact stays null.
//
//   Billing errors          the flag's money_impact                                    high
//   Supplier price rise     (new price - old) x usual weekly quantity                  high
//   Cheaper supplier        price gap x weekly quantity (order minimum noted)          high
//   Menu price behind cost  (suggested - current) x weekly units                       medium
//   Delivery price gap      gap x delivery units, per week                             medium
//   Stockout risk           affected dish units a day x margin x days short            medium
//   Waste                   last week's waste dollars                                  medium
//   Missing payout          the shortfall                                              demo (planted Nessie data)
//   Prep, marketing         no dollar figure                                           low
import type { Confidence, Item } from "./types";

export type Impact = { impact_usd_week: number | null; basis: string; confidence: Confidence; evidence?: Item["evidence"]; playbook?: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function billingImpact(moneyImpact: number): Impact {
  return { impact_usd_week: round2(moneyImpact), basis: "What the invoice check found charged in error (a one-time amount to get back).", confidence: "high" };
}

export function priceRiseImpact(newUnit: number, oldUnit: number, weeklyQty: number, unit: string): Impact {
  return {
    impact_usd_week: round2((newUnit - oldUnit) * weeklyQty),
    basis: `(${money(newUnit)} - ${money(oldUnit)}) per ${unit} x ${fmt(weeklyQty)} ${unit} used a week. Assumes the same volume.`,
    confidence: "high",
    playbook: "supplier_price_rise",
  };
}

export function cheaperImpact(gapPerUnit: number, weeklyQty: number, unit: string, minOrder: number): Impact {
  const minimum = minOrder > 0 ? ` Their order minimum is ${money(minOrder)}; combine items to meet it.` : "";
  return { impact_usd_week: round2(gapPerUnit * weeklyQty), basis: `${money(gapPerUnit)} cheaper per ${unit} x ${fmt(weeklyQty)} ${unit} used a week.${minimum}`, confidence: "high" };
}

// extraPerPeriod: (suggested - current) x units sold in the period, summed over the dishes
export function menuPriceImpact(extraPerPeriod: number, days: number): Impact {
  return { impact_usd_week: round2((extraPerPeriod * 7) / days), basis: `(suggested - current price) x units sold in the last ${days} days, per week. Assumes demand holds.`, confidence: "medium" };
}

export function deliveryImpact(extraPerPeriod: number, days: number): Impact {
  return { impact_usd_week: round2((extraPerPeriod * 7) / days), basis: `The gap to the suggested app prices x app orders in the last ${days} days, per week.`, confidence: "medium" };
}

// dishes: the dishes that use the ingredient, with units a day and margin per plate
export function stockoutImpact(dishes: { name: string; unitsPerDay: number; margin: number }[], daysShort: number): Impact {
  if (!(daysShort > 0) || !dishes.length) return { impact_usd_week: null, basis: "", confidence: "low" };
  const perDay = dishes.reduce((s, d) => s + d.unitsPerDay * d.margin, 0);
  return {
    impact_usd_week: round2(perDay * daysShort),
    basis: `${dishes.map((d) => d.name).slice(0, 3).join(", ")}: about ${money(perDay)} of margin a day x ${fmt(daysShort)} day${daysShort === 1 ? "" : "s"} short. Assumes no substitute.`,
    confidence: "medium",
    playbook: "stockout_risk",
  };
}

export function wasteImpact(wasteWeek: number): Impact {
  return { impact_usd_week: round2(wasteWeek), basis: "Waste logged in the last 7 days, at cost.", confidence: "medium" };
}

export function payoutImpact(shortfall: number): Impact {
  return { impact_usd_week: round2(shortfall), basis: "What the delivery app still owes for that week (from the planted demo payouts).", confidence: "demo" };
}

export const NO_FIGURE: Impact = { impact_usd_week: null, basis: "", confidence: "low" };

// ---------- Ranking ----------

const CONFIDENCE_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2, demo: 3 };
export const MIN_WEEKLY_USD = 10;

// The findings worth the owner's attention first: by dollars a week, then confidence. Under $10 a
// week (or no figure) is hidden unless it needs a decision now.
export function rankFindings<T extends Pick<Item, "level" | "impact_usd_week" | "confidence">>(items: T[], n: number): T[] {
  return items
    .filter((i) => i.level === "act" || (i.impact_usd_week ?? 0) >= MIN_WEEKLY_USD)
    .sort(
      (a, b) =>
        (b.impact_usd_week ?? -1) - (a.impact_usd_week ?? -1) ||
        CONFIDENCE_ORDER[a.confidence ?? "low"] - CONFIDENCE_ORDER[b.confidence ?? "low"] ||
        (a.level === "act" ? 0 : 1) - (b.level === "act" ? 0 : 1),
    )
    .slice(0, n);
}
