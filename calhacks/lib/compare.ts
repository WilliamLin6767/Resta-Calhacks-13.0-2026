// Compare: one metric split by one breakdown, from analytics_compare() in supabase/05_compare.sql.
// Pure functions only, shared by the Compare page and the AI assistant.

import { z } from "zod";
import { formatMoney, formatWholeMoney } from "./format";
import { channelName } from "./insights";

// ---------- Metrics ----------

export const METRIC_IDS = [
  "revenue",
  "net_revenue",
  "orders",
  "avg_ticket",
  "units_sold",
  "gross_profit",
  "food_cost_pct",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type MetricDef = {
  id: MetricId;
  label: string;
  unit: "money" | "count" | "percent";
  description: string; // one plain line: the owner and the AI both read it
  orderLevel?: boolean; // counted per order, so it can't be split by dish or category
  lowerIsBetter?: boolean;
};

export const METRICS: Record<MetricId, MetricDef> = {
  revenue: { id: "revenue", label: "Revenue", unit: "money", description: "Money from orders, before tax and tips." },
  net_revenue: { id: "net_revenue", label: "Kept after delivery fees", unit: "money", orderLevel: true, description: "Revenue minus delivery app commissions: what you actually keep." },
  orders: { id: "orders", label: "Orders", unit: "count", orderLevel: true, description: "Number of orders (tickets), whatever their size." },
  avg_ticket: { id: "avg_ticket", label: "Average ticket", unit: "money", orderLevel: true, description: "Average spend per order: revenue divided by orders." },
  units_sold: { id: "units_sold", label: "Dishes sold", unit: "count", description: "Number of dishes and drinks sold." },
  gross_profit: { id: "gross_profit", label: "Profit after food cost", unit: "money", description: "Revenue minus ingredient cost, at the prices paid on the day." },
  food_cost_pct: { id: "food_cost_pct", label: "Food cost %", unit: "percent", lowerIsBetter: true, description: "Ingredient cost as a share of revenue. Lower is better." },
};

// ---------- Breakdowns ----------

export const BREAKDOWN_IDS = ["day", "weekday", "hour", "channel", "dish", "category"] as const;
export type BreakdownId = (typeof BREAKDOWN_IDS)[number];

export const BREAKDOWNS: Record<BreakdownId, { id: BreakdownId; label: string }> = {
  day: { id: "day", label: "Day" },
  weekday: { id: "weekday", label: "Day of the week" },
  hour: { id: "hour", label: "Hour of the day" },
  channel: { id: "channel", label: "Channel" },
  dish: { id: "dish", label: "Dish" },
  category: { id: "category", label: "Menu category" },
};

// ---------- Which pairs are allowed (same rule as the SQL) ----------

const DISH_LEVEL: BreakdownId[] = ["dish", "category"];

export function isValidPair(metric: MetricId, breakdown: BreakdownId): boolean {
  return !(METRICS[metric].orderLevel && DISH_LEVEL.includes(breakdown));
}

// A plain explanation of why a pair is blocked, or null when it's fine.
export function invalidPairReason(metric: MetricId, breakdown: BreakdownId): string | null {
  if (isValidPair(metric, breakdown)) return null;
  return `${METRICS[metric].label} is counted per order, and one order can hold several dishes, so it can't be split by ${BREAKDOWNS[breakdown].label.toLowerCase()}. Try Revenue or Dishes sold instead.`;
}

// How analytics_compare aggregates a pair (same rule as the SQL).
export function aggregationFor(metric: MetricId, breakdown: BreakdownId): CompareResult["aggregation"] {
  if (metric === "avg_ticket" || metric === "food_cost_pct") return "ratio";
  if (breakdown === "weekday" || breakdown === "hour") return "per_open_day";
  return "total";
}

// ---------- Query (from the URL or from the AI's tool call) ----------

export const CompareQuerySchema = z
  .object({
    metric: z.enum(METRIC_IDS),
    breakdown: z.enum(BREAKDOWN_IDS),
    days: z.union([z.literal(7), z.literal(30), z.literal(60)]),
  })
  .refine((q) => isValidPair(q.metric, q.breakdown), {
    message: "This metric can't be split by this breakdown.",
  });

export type CompareQuery = z.infer<typeof CompareQuerySchema>;

export const DEFAULT_COMPARE: CompareQuery = { metric: "revenue", breakdown: "weekday", days: 30 };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

// The first value of a param, whether it came once or repeated.
function first(params: Params, name: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(name) ?? undefined;
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

// Reads ?metric=&breakdown=&days= and falls back to revenue / weekday / 30 for anything invalid.
// If the pair itself is blocked, the metric is kept and the breakdown falls back.
export function parseCompareQuery(params: Params): CompareQuery {
  const m = first(params, "metric");
  const b = first(params, "breakdown");
  const d = Number(first(params, "days"));

  const metric = (METRIC_IDS as readonly string[]).includes(m ?? "") ? (m as MetricId) : DEFAULT_COMPARE.metric;
  let breakdown = (BREAKDOWN_IDS as readonly string[]).includes(b ?? "") ? (b as BreakdownId) : DEFAULT_COMPARE.breakdown;
  const days = d === 7 || d === 30 || d === 60 ? d : DEFAULT_COMPARE.days;
  if (!isValidPair(metric, breakdown)) breakdown = DEFAULT_COMPARE.breakdown;

  return { metric, breakdown, days };
}

// ---------- Result (matches analytics_compare's JSON) ----------

export type CompareRow = {
  key: string | number; // ISO date, ISO weekday 1-7, hour 0-23, channel id, dish name or category
  label: string;
  value: number | null;
  prev_value: number | null;
};

export type CompareResult = {
  metric: MetricId;
  breakdown: BreakdownId;
  aggregation: "ratio" | "per_open_day" | "total";
  period: { days: number; start: string; end: string; previous_start: string; previous_end: string };
  has_previous: boolean;
  rows: CompareRow[];
};

// ---------- Formatting ----------

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

// How a bucket is named on the chart: day "Sat Oct 18", hour "12pm", channel "DoorDash".
export function rowLabel(breakdown: BreakdownId, row: CompareRow): string {
  switch (breakdown) {
    case "day": {
      const date = new Date(`${row.key}T00:00:00Z`);
      return `${WEEKDAYS_SHORT[date.getUTCDay()]} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
    }
    case "hour":
      return hourLabel(Number(row.key));
    case "channel":
      return channelName(String(row.key));
    default:
      return row.label;
  }
}

// "-" for null, "22.4%", "1,234" (or "12.3" for an average), "$12.50" under $100, "$1,235" above.
export function formatMetricValue(metric: MetricId, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const unit = METRICS[metric].unit;
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "count") return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return Math.abs(value) < 100 ? formatMoney(value) : formatWholeMoney(value);
}

// "Revenue by day of the week, average per open day (last 30 days)"
export function compareTitle(result: Pick<CompareResult, "metric" | "breakdown" | "aggregation" | "period">): string {
  const average = result.aggregation === "per_open_day" ? ", average per open day" : "";
  return `${METRICS[result.metric].label} by ${BREAKDOWNS[result.breakdown].label.toLowerCase()}${average} (last ${result.period.days} days)`;
}

// Ranked horizontal bars for categories, columns for things with a natural order.
export function chartLayout(breakdown: BreakdownId): "ranked" | "columns" {
  return breakdown === "channel" || breakdown === "dish" || breakdown === "category" ? "ranked" : "columns";
}

// One or two sentences for screen readers and for the AI: highest and lowest bucket,
// plus the number of closed days when broken down by day.
export function compareSummary(result: CompareResult): string {
  const withValues = result.rows.filter((r) => r.value !== null);
  if (withValues.length === 0) return `${compareTitle(result)}: no data for this period.`;

  const highest = withValues.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
  const lowest = withValues.reduce((a, b) => ((b.value ?? 0) < (a.value ?? 0) ? b : a));
  const fmt = (r: CompareRow) => `${rowLabel(result.breakdown, r)} at ${formatMetricValue(result.metric, r.value)}`;

  let text =
    withValues.length === 1
      ? `${compareTitle(result)}: only ${fmt(highest)}.`
      : `${compareTitle(result)}: highest is ${fmt(highest)}, lowest is ${fmt(lowest)}.`;

  if (result.breakdown === "day") {
    const closed = result.rows.length - withValues.length;
    if (closed > 0) text += ` ${closed} closed day${closed === 1 ? "" : "s"} had no orders.`;
  }
  return text;
}
