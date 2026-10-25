// Analytics: the dashboard summary for a period, and the AI report (the same as /api/analytics/report).
import { z } from "zod";
import { loadAnalytics } from "@/app/analytics/data";
import type { Digest } from "@/lib/analytics";
import { reportLimit, runReport } from "@/lib/analyticsReport";
import { changed, json, defineTool, type AgentCtx } from "../types";

async function digestFor(ctx: AgentCtx): Promise<Digest | string> {
  if (ctx.digest) return ctx.digest;
  const loaded = await loadAnalytics(ctx.days);
  if ("error" in loaded) return `Error: the dashboard summary is unavailable (${loaded.error}).`;
  ctx.digest = loaded.digest;
  return loaded.digest;
}

export const analyticsTools = [
  defineTool({
    name: "get_dashboard_summary",
    description:
      "The restaurant's sales and costs for the period: KPIs (this period vs the one before), weekday and hour patterns, channels, menu, costs, supplier price changes, " +
      "and notes that explain every calculation. No stock quantities.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const digest = await digestFor(ctx);
      if (typeof digest === "string") return digest;
      // The panel gets everything but the long day-by-day list; the chat a shorter version
      if (ctx.kind === "panel") {
        const full: Partial<Digest> = { ...digest };
        delete full.daily;
        return json(full);
      }
      return json({ restaurant: digest.restaurant, period: digest.period, kpis: digest.kpis, costs: digest.costs, price_changes: digest.price_changes });
    },
  }),
  defineTool({
    name: "run_analytics_report",
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
];
