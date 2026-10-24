import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadCompare } from "@/app/analytics/compareData";
import { loadAnalytics } from "@/app/analytics/data";
import type { Digest } from "@/lib/analytics";
import {
  ASSISTANT_SYSTEM_PROMPT,
  AssistantRequestSchema,
  chartContext,
  chartFromResult,
  checkQuestion,
  explainChartMessage,
  explainCompareMessage,
  screenContextText,
  type AssistantChart,
  type AssistantResponse,
} from "@/lib/assistant";
import {
  BREAKDOWNS,
  BREAKDOWN_IDS,
  CompareQuerySchema,
  METRICS,
  METRIC_IDS,
  invalidPairReason,
  type BreakdownId,
  type CompareResult,
  type MetricId,
} from "@/lib/compare";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

// Change this one line to try a different Claude model.
const AI_MODEL = "claude-sonnet-5-5";
const MAX_CHARTS = 2;

// Rate limits: 20 questions per visitor per 10 minutes, and 300 per day for the whole app.
const perVisitor = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 300, windowMs: 24 * 60 * 60 * 1000 });

// Server only, so ANTHROPIC_API_KEY never reaches the browser.
const anthropic = new Anthropic();

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

// The metric and breakdown lists, written into the tool descriptions so the model knows its options.
const METRIC_LIST = METRIC_IDS.map((id) => `- ${id}: ${METRICS[id].label}. ${METRICS[id].description}`).join("\n");
const BREAKDOWN_LIST = BREAKDOWN_IDS.map((id) => `- ${id}: ${BREAKDOWNS[id].label}`).join("\n");
const PAIR_RULE = "net_revenue, orders and avg_ticket are per order, so they can't be split by dish or category.";

// POST /api/assistant  body: { days, messages, explain?, page? }
export async function POST(request: Request) {
  // 1. Rate limit before doing any work.
  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) {
    return errorResponse("You've asked a lot of questions in the last 10 minutes. Try again in a few minutes.", 429, {
      "Retry-After": String(visitor.retryAfterSeconds),
    });
  }
  const app = wholeApp("all");
  if (!app.ok) {
    return errorResponse("The assistant has reached today's limit. Try again tomorrow.", 429, {
      "Retry-After": String(app.retryAfterSeconds),
    });
  }

  // 2. Validate the request.
  const parsed = AssistantRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("That request isn't in the expected format.", 400);
  const req = parsed.data;
  const problem = checkQuestion(req);
  if (problem) return errorResponse(problem, 400);
  const days = req.days;

  // 3. The numbers for this period.
  const loaded = await loadAnalytics(days);
  if ("error" in loaded) return errorResponse(`Could not load analytics: ${loaded.error}`, 500);
  const digest = loaded.digest;

  // 4. "Explain" replaces a trailing user message with a prepared one.
  const messages = [...req.messages];
  if (req.explain) {
    if (messages.at(-1)?.role === "user") messages.pop();
    let content: string;
    if ("chart" in req.explain) {
      content = explainChartMessage(chartContext(req.explain.chart, digest), days);
    } else {
      const query = CompareQuerySchema.safeParse({ ...req.explain.compare, days });
      if (!query.success) {
        return errorResponse(invalidPairReason(req.explain.compare.metric, req.explain.compare.breakdown) ?? "Invalid chart.", 400);
      }
      const compare = await loadCompare(query.data);
      if ("error" in compare) return errorResponse(`Could not load the chart: ${compare.error}`, 500);
      content = explainCompareMessage(compare.result);
    }
    messages.push({ role: "user", content });
  }

  // 5. Tools. Every number and chart comes from the database through these.
  const charts: AssistantChart[] = [];
  const digestWithoutDaily: Partial<Digest> = { ...digest };
  delete digestWithoutDaily.daily;

  // Runs analytics_compare for the request's period. Returns an "Error: ..." string for the model on failure.
  async function runCompare(metric: MetricId, breakdown: BreakdownId): Promise<CompareResult | string> {
    const query = CompareQuerySchema.safeParse({ metric, breakdown, days });
    if (!query.success) {
      return `Error: ${invalidPairReason(metric, breakdown) ?? "Invalid metric or breakdown."} Pick another breakdown.`;
    }
    const compare = await loadCompare(query.data);
    return "error" in compare ? `Error: ${compare.error}` : compare.result;
  }

  const compareInput = z.object({ metric: z.enum(METRIC_IDS), breakdown: z.enum(BREAKDOWN_IDS) });

  const tools = [
    betaZodTool({
      name: "get_dashboard_summary",
      description:
        "The whole dashboard summary for the period: KPIs (this period vs the one before), weekday and hour patterns, channels, menu, costs, supplier price changes, and notes that explain every calculation. " +
        `Metrics you can compare with compare_data:\n${METRIC_LIST}\nBreakdowns:\n${BREAKDOWN_LIST}`,
      inputSchema: z.object({}),
      run: async () => JSON.stringify(digestWithoutDaily),
    }),
    betaZodTool({
      name: "compare_data",
      description:
        `One metric split by one breakdown for the period, with the previous period for comparison. ${PAIR_RULE}\n` +
        `Metrics:\n${METRIC_LIST}\nBreakdowns:\n${BREAKDOWN_LIST}`,
      inputSchema: compareInput,
      run: async ({ metric, breakdown }) => {
        const result = await runCompare(metric, breakdown);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    }),
    betaZodTool({
      name: "show_chart",
      description: `Show the owner a bar chart of one metric by one breakdown (same options as compare_data). At most ${MAX_CHARTS} charts per answer. ${PAIR_RULE}`,
      inputSchema: compareInput,
      run: async ({ metric, breakdown }) => {
        const result = await runCompare(metric, breakdown);
        if (typeof result === "string") return result;
        const shown = charts.length < MAX_CHARTS;
        if (shown) charts.push(chartFromResult(result));
        return JSON.stringify({
          shown,
          note: shown ? "The owner can see this chart." : `Not shown: already showing ${MAX_CHARTS} charts.`,
          rows: result.rows,
        });
      },
    }),
  ];

  const period = digest.period;
  const contextLine =
    `Period: ${period.start} to ${period.end} (last ${days} days), compared with ${period.previous_start} to ${period.previous_end}. ` +
    `Restaurant: ${digest.restaurant}.` +
    (req.page ? ` The owner is looking at: ${req.page}.` : "");

  // What's on screen. The browser sent only chart ids; the numbers are looked up here.
  // If the focused Compare chart fails to load, its title is still used.
  let focusedCompare: CompareResult | undefined;
  const focus = req.view?.focus;
  if (focus && "compare" in focus) {
    const query = CompareQuerySchema.safeParse({ ...focus.compare, days });
    if (query.success) {
      const loadedCompare = await loadCompare(query.data);
      if ("result" in loadedCompare) focusedCompare = loadedCompare.result;
    }
  }
  const screenText = screenContextText(req.view, digest, focusedCompare);

  // 6. Ask Claude. The tool runner calls the tools and loops until Claude answers.
  let final;
  try {
    final = await anthropic.beta.messages.toolRunner({
      model: AI_MODEL,
      max_tokens: 4000,
      max_iterations: 6,
      thread: false, // send the full history each turn
      // If a safety check declines the request, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [ASSISTANT_SYSTEM_PROMPT, contextLine, screenText].filter(Boolean).join("\n\n"),
      messages,
      tools,
    });
  } catch (err) {
    // 7. Most specific errors first, same as the report route.
    if (err instanceof Anthropic.AuthenticationError) {
      return errorResponse("The Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY in .env.local.", 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return errorResponse("Too many AI requests right now. Wait a minute and try again.", 429);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return errorResponse("Could not reach the AI service. Check your internet connection.", 502);
    }
    if (err instanceof Anthropic.APIError) {
      return errorResponse(`AI request failed (${err.status}): ${err.message}`, 502);
    }
    throw err;
  }

  if (final.stop_reason === "refusal") {
    return errorResponse("The assistant declined to answer that.", 422);
  }
  const answer = final.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  if (!answer) return errorResponse("The assistant didn't come up with an answer. Try asking another way.", 502);

  // 8. The answer plus any charts it asked to show.
  const body: AssistantResponse = { answer, charts };
  return Response.json(body);
}
