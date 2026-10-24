// Pure functions that turn a digest into things to show. No database calls here,
// so everything can be tested with the saved fixtures.

import type { Digest, Kpis, SectionId } from "./analytics";
import { formatWholeMoney } from "./format";

const round1 = (x: number) => Math.round(x * 10) / 10;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

// ---------- Changes ----------

// % change from prev to cur, 1 decimal. Null when a value is missing or prev is 0.
// Divides by |prev| so a negative prev (e.g. a loss) still gives the right sign.
export function percentChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (!isNum(cur) || !isNum(prev) || prev === 0) return null;
  return round1(((cur - prev) / Math.abs(prev)) * 100);
}

// Difference in percentage points (for values that are already percents), 1 decimal.
export function pointChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (!isNum(cur) || !isNum(prev)) return null;
  return round1(cur - prev);
}

// ---------- KPIs ----------

export type KpiDef = {
  key: keyof Kpis;
  label: string;
  kind: "money" | "count" | "percent";
  lowerIsBetter?: boolean; // for costs, going down is good
  hint: string;
};

export const KPI_DEFS: KpiDef[] = [
  { key: "revenue", label: "Revenue", kind: "money", hint: "Before tax and tips" },
  { key: "revenue_per_open_day", label: "Revenue per open day", kind: "money", hint: "Fair comparison when open days differ" },
  { key: "est_profit", label: "Estimated profit", kind: "money", hint: "After food, delivery fees and fixed costs" },
  { key: "food_cost_pct", label: "Food cost %", kind: "percent", lowerIsBetter: true, hint: "Share of revenue, at prices paid on the day" },
  { key: "prime_cost_pct", label: "Prime cost %", kind: "percent", lowerIsBetter: true, hint: "Food plus labor, share of revenue" },
  { key: "platform_fees", label: "Delivery app fees", kind: "money", lowerIsBetter: true, hint: "Commission paid to DoorDash and Uber Eats" },
];

export type Tone = "good" | "bad" | "neutral";
export type KpiChange = { value: number; unit: "%" | "pts"; tone: Tone };

// How a KPI moved vs the previous period. Percent KPIs use points, others use %.
export function kpiChange(def: KpiDef, cur: Kpis | undefined, prev: Kpis | undefined): KpiChange | null {
  if (!cur || !prev) return null;
  const isPercent = def.kind === "percent";
  const value = isPercent ? pointChange(cur[def.key], prev[def.key]) : percentChange(cur[def.key], prev[def.key]);
  if (value === null) return null;
  return { value, unit: isPercent ? "pts" : "%", tone: toneFor(value, def.lowerIsBetter) };
}

function toneFor(value: number, lowerIsBetter = false): Tone {
  if (value === 0) return "neutral";
  return value > 0 !== lowerIsBetter ? "good" : "bad";
}

// ---------- Names ----------

const CHANNEL_NAMES: Record<string, string> = {
  dine_in: "Dine-in",
  takeout: "Takeout",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
};

export function channelName(id: string): string {
  return CHANNEL_NAMES[id] ?? id;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- "What changed" alerts (fixed rules, no AI) ----------

// These thresholds are judgment calls for a small restaurant, not industry standards.
// Change them here and every rule below follows.
export const ALERT_THRESHOLDS = {
  revenuePerOpenDayPct: 5, // revenue per open day moved at least this many %
  foodCostPts: 0.5, // food cost % moved at least this many points
  channelNetPct: 10, // a channel's net revenue moved at least this many %
  channelMinSharePct: 5, // ...and the channel is at least this share of revenue
  dishUnitsPct: 20, // a dish's units moved at least this many %
  dishMinUnits: 50, // ...and it sold at least this many in either period
  maxDishAlerts: 2,
  maxAlerts: 6,
};

export type Alert = {
  id: string;
  tone: "bad" | "info" | "good";
  title: string;
  detail?: string;
  section: SectionId;
};

const upDown = (x: number) => (x > 0 ? "up" : "down");
const pct = (x: number) => `${Math.abs(x)}%`;

export function buildAlerts(digest: Digest): Alert[] {
  const t = ALERT_THRESHOLDS;
  const { cur, prev } = digest.kpis;
  const days = digest.period.days;
  const alerts: Alert[] = [];

  // Price increases that cost us money this period (current supplier only).
  const increases = digest.price_changes
    .filter((p) => isNum(p.est_period_impact) && p.est_period_impact > 0)
    .sort((a, b) => (b.est_period_impact ?? 0) - (a.est_period_impact ?? 0));

  // 1. Revenue. Total and per-open-day can disagree when open days differ.
  if (cur && prev) {
    const total = percentChange(cur.revenue, prev.revenue);
    const perDay = percentChange(cur.revenue_per_open_day, prev.revenue_per_open_day);
    const daysDiffer = cur.open_days !== prev.open_days;
    if (daysDiffer && total !== null && perDay !== null && total * perDay < 0) {
      alerts.push({
        id: "revenue-open-days",
        tone: "info",
        title: `Total revenue is ${upDown(total)} ${pct(total)}, but revenue per open day is ${upDown(perDay)} ${pct(perDay)}.`,
        detail: `You were open ${cur.open_days} days this period and ${prev.open_days} days before, so compare per open day: ${formatWholeMoney(cur.revenue_per_open_day)} vs ${formatWholeMoney(prev.revenue_per_open_day)}.`,
        section: "kpis",
      });
    } else if (perDay !== null && Math.abs(perDay) >= t.revenuePerOpenDayPct) {
      alerts.push({
        id: "revenue-per-day",
        tone: perDay > 0 ? "good" : "bad",
        title: `Revenue per open day is ${upDown(perDay)} ${pct(perDay)}: ${formatWholeMoney(cur.revenue_per_open_day)} vs ${formatWholeMoney(prev.revenue_per_open_day)}.`,
        section: "kpis",
      });
    }
  }

  // 2. Food cost %.
  const foodPts = pointChange(cur?.food_cost_pct, prev?.food_cost_pct);
  if (cur && prev && foodPts !== null && Math.abs(foodPts) >= t.foodCostPts) {
    const rose = foodPts > 0;
    const supplierDriven = rose && increases.length > 0;
    alerts.push({
      id: "food-cost",
      tone: rose ? "bad" : "good",
      title: `Food cost ${rose ? "rose" : "fell"} from ${prev.food_cost_pct}% to ${cur.food_cost_pct}% of revenue (${rose ? "+" : ""}${foodPts} pts).`,
      detail: supplierDriven
        ? `Supplier prices went up on ${increases.length} ingredient${increases.length === 1 ? "" : "s"} you buy. See the supplier price changes.`
        : undefined,
      section: supplierDriven ? "price_changes" : "costs",
    });
  }

  // 3. Supplier price increases with a real cost this period.
  if (increases.length > 0) {
    const total = increases.reduce((sum, p) => sum + (p.est_period_impact ?? 0), 0);
    const earliest = increases.map((p) => p.since).sort()[0];
    const top = increases
      .slice(0, 3)
      .map((p) => `${p.ingredient} +${formatWholeMoney(p.est_period_impact)}`)
      .join(", ");
    const cheaper = increases.filter((p) => p.cheapest_supplier);
    const cheaperText =
      cheaper.length > 0
        ? ` Cheaper elsewhere: ${cheaper.map((p) => `${p.ingredient} at ${p.cheapest_supplier}`).join(", ")}.`
        : "";
    alerts.push({
      id: "supplier-prices",
      tone: "bad",
      title: `${increases.length} supplier price increase${increases.length === 1 ? "" : "s"} since ${earliest} cost about ${formatWholeMoney(total)} per ${days} days at your current sales.`,
      detail: `Biggest: ${top}.${cheaperText}`,
      section: "price_changes",
    });
  }

  // 4. Channels whose net revenue (after fees) moved a lot.
  for (const c of digest.channels) {
    const change = c.net_revenue_change_pct;
    if (!isNum(change) || !isNum(c.revenue_share_pct)) continue;
    if (c.revenue_share_pct < t.channelMinSharePct || Math.abs(change) < t.channelNetPct) continue;
    alerts.push({
      id: `channel-${c.channel}`,
      tone: change > 0 ? "good" : "bad",
      title: `${channelName(c.channel)} net revenue ${change > 0 ? "rose" : "fell"} ${pct(change)}: you kept ${formatWholeMoney(c.net_revenue)} after fees vs ${formatWholeMoney(c.prev_net_revenue)}.`,
      section: "channels",
    });
  }

  // 5. Dishes whose sales moved a lot (biggest moves first, at most 2).
  digest.menu
    .filter(
      (m) =>
        isNum(m.units_change_pct) &&
        Math.abs(m.units_change_pct) >= t.dishUnitsPct &&
        Math.max(m.units, m.prev_units) >= t.dishMinUnits,
    )
    .sort((a, b) => Math.abs(b.units_change_pct ?? 0) - Math.abs(a.units_change_pct ?? 0))
    .slice(0, t.maxDishAlerts)
    .forEach((m) => {
      const change = m.units_change_pct ?? 0;
      alerts.push({
        id: `dish-${m.name}`,
        tone: change > 0 ? "good" : "bad",
        title: `${m.name} sales ${change > 0 ? "rose" : "fell"} ${pct(change)}: ${m.units} sold vs ${m.prev_units}.`,
        section: "menu",
      });
    });

  // Bad first, then info, then good. sort() is stable, so rule order is kept within a tone.
  const rank = { bad: 0, info: 1, good: 2 };
  return alerts.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, t.maxAlerts);
}

// ---------- Is a saved AI report out of date? ----------

export function isReportStale(saved: Partial<Digest> | null | undefined, current: Digest): boolean {
  if (!saved) return true;
  if (saved.version !== current.version) return true;
  if (saved.period?.end !== current.period.end) return true;
  return !sameValues(saved.kpis?.cur, current.kpis.cur);
}

function sameValues(a: object | undefined, b: object | undefined): boolean {
  if (!a || !b) return a === b;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k] === y[k]);
}

// ---------- Waterfall: revenue down to estimated profit ----------

export type WaterfallStep = {
  label: string;
  amount: number; // signed: revenue and profit as-is, costs negative
  base: number; // where the floating bar starts
  value: number; // bar height (never negative)
  kind: "total" | "cost" | "result";
};

// Steps for a stacked bar: an invisible `base` bar with the visible `value` bar on top.
// Each cost floats between the running total before and after it, even if that goes below zero.
export function buildWaterfall(digest: Digest): WaterfallStep[] {
  const cur = digest.kpis.cur;
  if (!cur) return [];

  const costs = [
    { label: "Food", amount: digest.costs.food },
    { label: "Delivery app fees", amount: digest.costs.platform_fees },
    ...Object.entries(digest.costs.fixed).map(([category, amount]) => ({ label: titleCase(category), amount })),
  ]
    .filter((c) => c.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  const steps: WaterfallStep[] = [
    { label: "Revenue", amount: cur.revenue, base: Math.min(0, cur.revenue), value: Math.abs(cur.revenue), kind: "total" },
  ];

  let running = cur.revenue;
  for (const cost of costs) {
    const next = running - cost.amount;
    steps.push({
      label: cost.label,
      amount: -cost.amount,
      base: Math.min(running, next),
      value: Math.abs(cost.amount),
      kind: "cost",
    });
    running = next;
  }

  steps.push({
    label: "Estimated profit",
    amount: running,
    base: Math.min(0, running),
    value: Math.abs(running),
    kind: "result",
  });
  return steps;
}
