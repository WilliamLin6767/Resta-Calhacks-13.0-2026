// Analytics and money: the dashboard summary for a period, the AI report (the same as
// /api/analytics/report), comparisons and charts (moved from the assistant panel), the cash plan,
// and profit_opportunities, which ranks every money-making option the app's math finds.
import { z } from "zod";
import { loadCompare } from "@/app/analytics/compareData";
import { loadAnalytics } from "@/app/analytics/data";
import { loadAccounting } from "@/lib/accounting/service";
import type { Digest } from "@/lib/analytics";
import { reportLimit, runReport } from "@/lib/analyticsReport";
import { chartFromResult } from "@/lib/assistant";
import { loadMoney } from "@/lib/bank/cashPlan";
import { loadBank } from "@/lib/bank/service";
import { BREAKDOWNS, BREAKDOWN_IDS, CompareQuerySchema, METRICS, METRIC_IDS, invalidPairReason, type BreakdownId, type CompareResult, type MetricId } from "@/lib/compare";
import { loadInventory } from "@/lib/inventory/service";
import { loadPricing } from "@/lib/pricing/service";
import { loadFlags, weeklyUseByName } from "../evidence";
import { profitOpportunities } from "../investigate";
import { changed, json, round2, defineTool, type AgentCtx } from "../types";

const MAX_CHARTS = 2;

async function digestFor(ctx: AgentCtx): Promise<Digest | string> {
  if (ctx.digest) return ctx.digest;
  const loaded = await loadAnalytics(ctx.days);
  if ("error" in loaded) return `Error: the dashboard summary is unavailable (${loaded.error}).`;
  ctx.digest = loaded.digest;
  return loaded.digest;
}

// analytics_compare for the conversation's period. An "Error: ..." string on failure.
async function runCompare(ctx: AgentCtx, metric: MetricId, breakdown: BreakdownId): Promise<CompareResult | string> {
  const query = CompareQuerySchema.safeParse({ metric, breakdown, days: ctx.days });
  if (!query.success) return `Error: ${invalidPairReason(metric, breakdown) ?? "Invalid metric or breakdown."} Pick another breakdown.`;
  const compare = await loadCompare(query.data);
  return "error" in compare ? `Error: ${compare.error}` : compare.result;
}

const METRIC_LIST = METRIC_IDS.map((id) => `- ${id}: ${METRICS[id].label}. ${METRICS[id].description}`).join("\n");
const BREAKDOWN_LIST = BREAKDOWN_IDS.map((id) => `- ${id}: ${BREAKDOWNS[id].label}`).join("\n");
const PAIR_RULE = "net_revenue, orders and avg_ticket are per order, so they can't be split by dish or category.";
const compareInput = z.object({ metric: z.enum(METRIC_IDS), breakdown: z.enum(BREAKDOWN_IDS) });

export const analyticsTools = [
  defineTool({
    name: "get_dashboard_summary",
    tier: "read",
    area: "analytics",
    description:
      "The restaurant's sales and costs for the period: KPIs (this period vs the one before), weekday and hour patterns, channels, menu, costs, supplier price changes, " +
      "and notes that explain every calculation. No stock quantities.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const digest = await digestFor(ctx);
      if (typeof digest === "string") return digest;
      // The panel gets everything but the long day-by-day list; the chat a shorter version
      if (ctx.surface === "panel") {
        const full: Partial<Digest> = { ...digest };
        delete full.daily;
        return json(full);
      }
      return json({ restaurant: digest.restaurant, period: digest.period, kpis: digest.kpis, costs: digest.costs, price_changes: digest.price_changes });
    },
  }),
  defineTool({
    name: "compare_data",
    tier: "read",
    area: "analytics",
    description:
      `One metric split by one breakdown for the period, with the previous period for comparison. ${PAIR_RULE}\n` +
      `Metrics:\n${METRIC_LIST}\nBreakdowns:\n${BREAKDOWN_LIST}`,
    input: compareInput,
    run: async ({ metric, breakdown }, ctx) => {
      const result = await runCompare(ctx, metric, breakdown);
      return typeof result === "string" ? result : json(result);
    },
  }),
  defineTool({
    name: "show_chart",
    tier: "read",
    area: "analytics",
    surfaces: ["panel"],
    description: `Show the owner a bar chart of one metric by one breakdown (same options as compare_data). At most ${MAX_CHARTS} charts per answer. ${PAIR_RULE}`,
    input: compareInput,
    run: async ({ metric, breakdown }, ctx) => {
      const result = await runCompare(ctx, metric, breakdown);
      if (typeof result === "string") return result;
      const shown = ctx.charts.length < MAX_CHARTS;
      if (shown) ctx.charts.push(chartFromResult(result));
      return json({ shown, note: shown ? "The owner can see this chart." : `Not shown: already showing ${MAX_CHARTS} charts.`, rows: result.rows });
    },
  }),
  defineTool({
    name: "run_analytics_report",
    tier: "draft",
    area: "analytics",
    description: "Have the AI write its report on the dashboard for the last 7, 30 or 60 days (reuses one made in the last 5 minutes). Slow; only when the owner asks for an analysis.",
    input: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(60)]).optional() }),
    run: async ({ days }, ctx) => {
      const limited = reportLimit(ctx.identity);
      if (limited && !limited.ok) return `Error: ${limited.error}`;
      const result = await runReport(ctx.db, days ?? ctx.days);
      if (!result.ok) return `Error: ${result.error}`;
      const period = days ?? ctx.days;
      if (!result.body.cached) changed(ctx, { kind: "ai_report", label: `New AI report for the last ${period} days`, before: null, after: null });
      return json({ ...result.body, page: `/analytics/ai?days=${period}` });
    },
  }),
  defineTool({
    name: "get_cash_plan",
    tier: "read",
    area: "analytics",
    description: "Bills to pay (overdue, due soon, later), what the delivery apps still owe, the bank balance (Capital One Nessie), and the cash plan for the next two weeks.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const accounting = await loadAccounting(ctx.db);
      const [bank, money] = await Promise.all([
        loadBank(ctx.db, accounting).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })),
        loadMoney(ctx.db, accounting).catch(() => null),
      ]);
      const bills = Object.fromEntries(
        Object.entries(accounting.bills).map(([group, list]) => [
          group,
          { count: list.length, total: round2(list.reduce((s, b) => s + b.total, 0)), bills: list.slice(0, 10).map((b) => ({ id: b.id, supplier: b.supplier, invoice_number: b.invoice_number, due: b.due_date, total: b.total, disputed: b.disputed })) },
        ]),
      );
      return json({
        today: accounting.today,
        bills,
        delivery_apps_owe: round2(accounting.owed),
        bank: "error" in bank ? { error: bank.error } : bank.connected ? { balance: bank.account.balance, savings: bank.savings, cash: bank.cash, bank: "Capital One Nessie" } : { connected: false },
        cash_plan: money ? { forecast: money.forecast, suggested_move_to_savings: money.move, food_budget: money.budget } : null,
      });
    },
  }),
  defineTool({
    name: "profit_opportunities",
    tier: "read",
    area: "analytics",
    description:
      "Every way the app's math finds to make or save money, ranked by dollars, each with how the figure was worked out: menu price raises, billing errors, " +
      "cheaper suppliers, waste, low-margin dishes and delivery prices below target. Use for 'how can I make more money'. days: the sales period (7, 30 or 60).",
    input: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(60)]).optional() }),
    run: async ({ days }, ctx) => {
      const period = days ?? ctx.days;
      if (days && days !== ctx.days) {
        ctx.days = days;
        ctx.digest = null;
      }
      const [digest, pricing, flags, inventory] = await Promise.all([digestFor(ctx), loadPricing(ctx.db, period), loadFlags(ctx.db), loadInventory(ctx.db)]);
      if (typeof digest === "string") return digest;
      const list = profitOpportunities({
        days: period,
        suggestions: pricing.suggestions,
        delivery: pricing.delivery,
        flags,
        wasteWeek: inventory.wasteWeek,
        menu: digest.menu,
        marginThreshold: digest.menu_thresholds.margin_threshold,
        priceChanges: digest.price_changes,
        weeklyUse: weeklyUseByName(inventory.lines),
      });
      return json({ period_days: period, count: list.length, opportunities: list.slice(0, 12) });
    },
  }),
];
