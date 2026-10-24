// The on-screen AI assistant: request shape, chart context and prompts.
// Pure functions only; the route in app/api/assistant does the calling.

import { z } from "zod";
import type { Digest } from "./analytics";
import {
  BREAKDOWN_IDS,
  METRICS,
  METRIC_IDS,
  compareSummary,
  compareTitle,
  type CompareResult,
} from "./compare";
import { ALERT_THRESHOLDS, buildAlerts, buildWaterfall } from "./insights";

// ---------- Charts the owner can ask to have explained ----------

export const CHART_IDS = [
  "kpis",
  "alerts",
  "daily",
  "weekday",
  "hour",
  "channels",
  "waterfall",
  "menu",
  "price_changes",
] as const;
export type ChartId = (typeof CHART_IDS)[number];

export type ChartContext = { title: string; howItWorks: string; data: unknown };

// What one chart is, how it's built, and only its slice of the digest.
// howItWorks restates the SQL notes and lib/insights.ts so the AI doesn't guess.
export function chartContext(id: ChartId, digest: Digest): ChartContext {
  switch (id) {
    case "kpis":
      return {
        title: "Key numbers",
        howItWorks:
          "Each number compares this period (cur) with the same-length period just before it (prev). Revenue is order subtotals before tax and tips; food cost prices each dish at the ingredient prices in effect on its order date. Fixed costs, including labor, are monthly averages prorated to the period, and estimated profit is revenue minus food, delivery fees and fixed costs.",
        data: { period: digest.period, cur: digest.kpis.cur ?? null, prev: digest.kpis.prev ?? null },
      };
    case "alerts":
      return {
        title: "What changed",
        howItWorks:
          "These alerts come from fixed rules, not AI. Each one fires when a number moves past a threshold (for example revenue per open day by 5% or food cost by 0.5 points); the thresholds are judgment calls, not industry standards.",
        data: { alerts: buildAlerts(digest), thresholds: ALERT_THRESHOLDS },
      };
    case "daily":
      return {
        title: "Revenue per day",
        howItWorks:
          "One bar per day of the period, using order subtotals before tax and tips. Days with no orders show as closed with zero revenue. Today is left out because it isn't over.",
        data: digest.daily,
      };
    case "weekday":
      return {
        title: "Average revenue by weekday",
        howItWorks:
          "Each weekday's average is taken over the days the restaurant was open on that weekday only. `days` says how many open days each average is based on, so averages from 1 or 2 days are a rough guide.",
        data: digest.by_weekday,
      };
    case "hour":
      return {
        title: "Average orders by hour",
        howItWorks:
          "Orders and revenue in each local hour, divided by all open days in the period, so each bar is a typical open day.",
        data: digest.by_hour,
      };
    case "channels":
      return {
        title: "Revenue by channel",
        howItWorks:
          "Revenue is gross (before platform fees); net_revenue is what the restaurant keeps after delivery app commissions. Channels should be judged by net revenue, compared with the previous period.",
        data: digest.channels,
      };
    case "waterfall":
      return {
        title: "Where the money goes",
        howItWorks:
          "Starts at revenue and subtracts each cost, biggest first: food at the prices paid on the day, delivery app fees, then each fixed cost prorated to the period. What is left is estimated profit.",
        data: buildWaterfall(digest),
      };
    case "menu":
      return {
        title: "Menu engineering",
        howItWorks:
          "Each dish is placed by units sold and margin per plate at today's ingredient prices. Popular means units at least 70% of an equal share; profitable means margin at or above the units-weighted average. Sides, drinks and desserts are compared with mains, so a cheap side can rank low and still be worth keeping.",
        data: { dishes: digest.menu, thresholds: digest.menu_thresholds },
      };
    case "price_changes":
      return {
        title: "Supplier price changes",
        howItWorks:
          "Prices are per pack. est_period_impact is set only for the ingredient's current supplier: the change in unit cost times the amount used by the dishes sold this period. cheapest_supplier is set only when another supplier is cheaper now.",
        data: digest.price_changes,
      };
  }
}

// ---------- Request ----------

export const AssistantRequestSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(60)]),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(12),
  explain: z
    .union([
      z.object({ chart: z.enum(CHART_IDS) }).strict(),
      z.object({ compare: z.object({ metric: z.enum(METRIC_IDS), breakdown: z.enum(BREAKDOWN_IDS) }) }).strict(),
    ])
    .optional(),
  page: z.string().max(100).optional(),
});

export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;

// Extra checks the schema can't express. Returns a plain error, or null when it's fine.
export function checkQuestion(req: AssistantRequest): string | null {
  if (req.explain) return null;
  const last = req.messages[req.messages.length - 1];
  if (!last || last.role !== "user") return "Ask a question first.";
  if (last.content.length > 1000) return "Please keep your question under 1,000 characters.";
  return null;
}

// ---------- Response ----------

export type AssistantChart = CompareResult & { title: string };
export type AssistantResponse = { answer: string; charts: AssistantChart[] };

export function chartFromResult(result: CompareResult): AssistantChart {
  return { ...result, title: compareTitle(result) };
}

// ---------- Prompts ----------

export const ASSISTANT_SYSTEM_PROMPT = [
  "You are the assistant inside a restaurant's back-office dashboard. The reader is a busy restaurant owner, often on a phone between services.",
  "Get every number from your tools. Never invent a number, and never estimate one that a tool didn't return.",
  "Some things aren't tracked here, such as reviews, weather, customer demographics and staff hours. If asked about them, say plainly that the data doesn't include them, and suggest what the data can show instead.",
  "Lead with the answer. Keep it under 120 words. Use dish names and dollar amounts.",
  "Call show_chart when a chart would help the owner see the answer.",
  "Before explaining how something is calculated, read the notes in the dashboard summary.",
  "When the number of open days differs between periods, compare revenue per open day, not total revenue. Judge delivery channels by what the restaurant keeps after fees.",
  "Label suggestions as suggestions.",
].join("\n");

const EXPLAIN_ASK =
  "Tell me what it shows, how to read it, the one thing that stands out, and one caveat. Don't call show_chart; I can already see it.";

export function explainChartMessage(ctx: ChartContext, days: number): string {
  return [
    `Explain the "${ctx.title}" chart for the last ${days} days. ${EXPLAIN_ASK}`,
    `How it's built: ${ctx.howItWorks}`,
    `Data (JSON): ${JSON.stringify(ctx.data)}`,
  ].join("\n\n");
}

export function explainCompareMessage(result: CompareResult): string {
  const metric = METRICS[result.metric];
  return [
    `Explain the chart "${compareTitle(result)}". ${EXPLAIN_ASK}`,
    `${metric.label}: ${metric.description} Aggregation: ${result.aggregation}.`,
    `Summary: ${compareSummary(result)}`,
    `Data (JSON): ${JSON.stringify(result)}`,
  ].join("\n\n");
}
