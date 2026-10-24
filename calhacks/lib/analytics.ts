import { z } from "zod";

// ---------- The digest returned by analytics_digest(p_restaurant_id, p_days) ----------

export type Kpis = {
  revenue: number;
  orders: number;
  avg_ticket: number;
  food_cost: number;
  food_cost_pct: number;
  platform_fees: number;
  labor: number;
  fixed_costs: number;
  est_profit: number;
  est_profit_pct: number;
  prime_cost_pct: number;
  open_days: number;
  revenue_per_open_day: number;
};

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export type MenuRow = {
  name: string;
  category: string;
  class: MenuClass;
  price: number;
  units: number;
  prev_units: number;
  units_change_pct: number | null;
  revenue: number;
  unit_food_cost: number;
  unit_margin: number;
  gross_profit: number;
  food_cost_pct: number;
};

export type ChannelRow = {
  channel: string;
  orders: number;
  revenue: number;
  net_revenue: number;
  platform_fees: number;
  fee_rate_pct: number;
  revenue_share_pct: number;
  prev_revenue: number;
  prev_net_revenue: number;
  net_revenue_change_pct: number | null;
};

export type PriceChangeRow = {
  ingredient: string;
  supplier: string;
  since: string;
  previous_price: number;
  current_price: number;
  change_pct: number;
  current_unit_cost: number;
  cheapest_supplier: string | null;
  cheapest_unit_cost: number | null;
  is_current_supplier: boolean;
  est_period_impact: number | null;
  dishes: string[];
};

export type Digest = {
  version: number;
  restaurant: string;
  period: { start: string; end: string; days: number; previous_start: string; previous_end: string };
  // prev is missing when there is no data before the period (e.g. 60 days on the demo data).
  kpis: { cur: Kpis; prev?: Kpis };
  daily: { date: string; open: boolean; orders: number; revenue: number }[];
  by_weekday: { weekday: string; days: number; avg_orders: number; avg_revenue: number }[];
  by_hour: { hour: number; avg_orders: number; avg_revenue: number }[];
  channels: ChannelRow[];
  menu: MenuRow[];
  menu_thresholds: { margin_threshold: number; popularity_threshold: number };
  costs: { food: number; platform_fees: number; fixed: Record<string, number> };
  price_changes: PriceChangeRow[];
  notes: string[];
};

// Chart colors, always used in this order so a category keeps its color.
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

// The four menu-engineering classes. Each has its own color AND marker shape,
// so the scatter chart doesn't rely on color alone.
export const MENU_CLASSES: {
  id: MenuClass;
  label: string;
  meaning: string;
  color: string;
  shape: "circle" | "square" | "triangle" | "diamond";
}[] = [
  { id: "star", label: "Star", meaning: "Popular and profitable. Keep it front and center.", color: SERIES_COLORS[0], shape: "circle" },
  { id: "plowhorse", label: "Plowhorse", meaning: "Popular but low margin. Try a small price bump or a cheaper recipe.", color: SERIES_COLORS[1], shape: "square" },
  { id: "puzzle", label: "Puzzle", meaning: "Profitable but not popular. Promote it or move it up the menu.", color: SERIES_COLORS[2], shape: "triangle" },
  { id: "dog", label: "Dog", meaning: "Neither popular nor profitable. Consider rethinking or removing it.", color: SERIES_COLORS[3], shape: "diamond" },
];

// The periods the page offers, in days.
export const PERIOD_OPTIONS = [7, 30, 60] as const;
export const DEFAULT_DAYS = 30;

// Turns a ?days= value into one of the allowed periods.
export function parseDays(value: unknown): number {
  const n = Number(value);
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_DAYS;
}

// ---------- The AI report (Claude must return exactly this shape) ----------

export const SECTION_IDS = [
  "kpis",
  "daily",
  "by_weekday",
  "by_hour",
  "channels",
  "menu",
  "costs",
  "price_changes",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const AiReportSchema = z.object({
  headline: z.string().describe("One sentence: the single most important thing"),
  health: z.enum(["good", "watch", "act"]).describe("Overall status"),
  sections: z
    .array(
      z.object({
        id: z.enum(SECTION_IDS),
        what_it_shows: z.string().describe("Plain-language explanation of the chart, 1 sentence"),
        what_it_means: z
          .string()
          .describe("What the numbers mean for this restaurant, 1-2 sentences, cite numbers"),
        status: z.enum(["good", "neutral", "concern"]),
      }),
    )
    .describe("One per chart, using the same ids as the page"),
  actions: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        estimated_impact: z.string(),
        area: z.enum(["menu", "pricing", "suppliers", "staffing", "marketing", "costs"]),
      }),
    )
    .describe("3 to 5 actions, most valuable first"),
});

export type AiReport = z.infer<typeof AiReportSchema>;
export type AiSection = AiReport["sections"][number];
