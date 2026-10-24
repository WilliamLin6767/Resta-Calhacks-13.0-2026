// What an expanded KPI card shows: how the number is worked out, with the real numbers
// plugged in, and the parts it's made of, this period vs the one before.
// Pure functions: every number comes from the digest.

import type { Digest, Kpis } from "./analytics";
import type { ModuleId } from "./analyticsSections";
import { formatMoney, formatWholeMoney } from "./format";
import { channelName, type KpiDef } from "./insights";

export type DetailRow = { label: string; cur: string; prev: string | null; strong?: boolean };
export type KpiDetail = { formula: string; rows: DetailRow[] };

// The module page with the charts behind each KPI.
export const KPI_MODULE: Record<string, ModuleId> = {
  revenue: "sales",
  revenue_per_open_day: "sales",
  est_profit: "costs",
  food_cost_pct: "suppliers",
  prime_cost_pct: "costs",
  platform_fees: "channels",
};

const money = (v: number | null | undefined) => (v === null || v === undefined ? "-" : formatWholeMoney(v));
const cents = (v: number | null | undefined) => (v === null || v === undefined ? "-" : formatMoney(v));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${v}%`);
const count = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toLocaleString("en-US"));

// The KPI's value as shown on its card.
export function formatKpiValue(def: KpiDef, kpis: Kpis | undefined): string {
  const v = kpis?.[def.key] ?? null;
  if (def.kind === "percent") return pct(v);
  if (def.kind === "count") return count(v);
  return money(v);
}

export function kpiDetail(def: KpiDef, digest: Digest): KpiDetail {
  const cur = digest.kpis.cur;
  const prev = digest.kpis.prev;
  if (!cur) return { formula: "No orders in this period.", rows: [] };

  // One row: the same field this period and last period.
  const row = (label: string, key: keyof Kpis, fmt: (v: number | null | undefined) => string, strong = false): DetailRow => ({
    label,
    cur: fmt(cur[key]),
    prev: prev ? fmt(prev[key]) : null,
    strong,
  });

  switch (def.key) {
    case "revenue":
      return {
        formula: "All order subtotals added up, before tax and tips.",
        rows: [
          row("Revenue", "revenue", money, true),
          row("Orders", "orders", count),
          row("Average ticket", "avg_ticket", cents),
          row("Open days", "open_days", count),
        ],
      };

    case "revenue_per_open_day":
      return {
        formula: `Revenue ÷ open days: ${money(cur.revenue)} ÷ ${cur.open_days} = ${money(cur.revenue_per_open_day)}. Use this when the number of open days differs.`,
        rows: [
          row("Revenue", "revenue", money),
          row("Open days", "open_days", count),
          row("Revenue per open day", "revenue_per_open_day", money, true),
        ],
      };

    case "est_profit":
      return {
        formula: `Revenue − food − delivery app fees − fixed costs: ${money(cur.revenue)} − ${money(cur.food_cost)} − ${money(cur.platform_fees)} − ${money(cur.fixed_costs)} = ${money(cur.est_profit)}.`,
        rows: [
          row("Revenue", "revenue", money),
          row("Food cost", "food_cost", money),
          row("Delivery app fees", "platform_fees", money),
          row("Fixed costs (incl. labor)", "fixed_costs", money),
          row("Estimated profit", "est_profit", money, true),
          row("Profit margin", "est_profit_pct", pct),
        ],
      };

    case "food_cost_pct":
      return {
        formula: `Food cost ÷ revenue: ${money(cur.food_cost)} ÷ ${money(cur.revenue)} = ${pct(cur.food_cost_pct)}. Each dish is costed at the ingredient prices paid on the day it sold.`,
        rows: [
          row("Food cost", "food_cost", money),
          row("Revenue", "revenue", money),
          row("Food cost %", "food_cost_pct", pct, true),
        ],
      };

    case "prime_cost_pct":
      return {
        formula: `(Food + labor) ÷ revenue: (${money(cur.food_cost)} + ${money(cur.labor)}) ÷ ${money(cur.revenue)} = ${pct(cur.prime_cost_pct)}.`,
        rows: [
          row("Food cost", "food_cost", money),
          row("Labor", "labor", money),
          row("Revenue", "revenue", money),
          row("Prime cost %", "prime_cost_pct", pct, true),
        ],
      };

    case "platform_fees": {
      // One row per delivery app. Last period's fees = gross minus what was kept.
      const apps = digest.channels.filter((c) => c.platform_fees > 0 || c.prev_revenue - c.prev_net_revenue > 0);
      return {
        formula: "The commission DoorDash and Uber Eats keep from each order. Revenue minus fees is what you keep.",
        rows: [
          ...apps.map((c) => ({
            label: `${channelName(c.channel)} fees${c.fee_rate_pct !== null ? ` (${c.fee_rate_pct}%)` : ""}`,
            cur: money(c.platform_fees),
            prev: prev ? money(c.prev_revenue - c.prev_net_revenue) : null,
          })),
          row("All delivery app fees", "platform_fees", money, true),
        ],
      };
    }

    default:
      return { formula: def.hint, rows: [row(def.label, def.key, def.kind === "percent" ? pct : money, true)] };
  }
}
