import { z } from "zod";

// ---------- The digest returned by analytics_digest(p_restaurant_id, p_days), version 2 ----------
// See supabase/03_analytics.sql. Money is rounded to 2 decimals, percents to 1.
// Anything divided by something that can be zero comes back as null.

export type Kpis = {
  revenue: number;
  orders: number;
  open_days: number;
  avg_ticket: number | null;
  revenue_per_open_day: number | null;
  food_cost: number;
  food_cost_pct: number | null;
  labor: number;
  prime_cost_pct: number | null;
  platform_fees: number;
  fixed_costs: number;
  est_profit: number;
  est_profit_pct: number | null;
};

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export type MenuRow = {
  name: string;
  category: string;
  price: number;
  units: number;
  prev_units: number;
  units_change_pct: number | null;
  revenue: number;
  unit_food_cost: number | null;
  food_cost_pct: number | null;
  unit_margin: number | null;
  gross_profit: number | null;
  class: MenuClass;
};

export type ChannelRow = {
  channel: string;
  orders: number;
  revenue: number;
  revenue_share_pct: number | null;
  platform_fees: number;
  fee_rate_pct: number | null;
  net_revenue: number;
  prev_revenue: number;
  prev_net_revenue: number;
  net_revenue_change_pct: number | null;
};

export type PriceChangeRow = {
  supplier: string;
  ingredient: string;
  previous_price: number; // per pack
  current_price: number; // per pack
  change_pct: number;
  since: string;
  is_current_supplier: boolean;
  dishes: string[];
  est_period_impact: number | null; // only for the current (preferred) supplier
  cheapest_supplier: string | null; // only when a different supplier is cheaper
  cheapest_unit_cost: number | null;
  current_unit_cost: number | null;
};

export type Digest = {
  version: number;
  restaurant: string;
  period: { days: number; start: string; end: string; previous_start: string; previous_end: string };
  // A period with no orders is missing, so both are optional.
  kpis: { cur?: Kpis; prev?: Kpis };
  daily: { date: string; revenue: number; orders: number; open: boolean }[];
  by_weekday: { weekday: string; avg_revenue: number; avg_orders: number; days: number }[];
  by_hour: { hour: number; avg_orders: number | null; avg_revenue: number | null }[];
  channels: ChannelRow[];
  menu: MenuRow[];
  menu_thresholds: { popularity_threshold: number | null; margin_threshold: number | null };
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

// Turns a ?days= value into 7, 30 or 60. Anything else falls back to 30.
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
