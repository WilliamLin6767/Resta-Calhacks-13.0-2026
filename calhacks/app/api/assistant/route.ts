import { loadCompare } from "@/app/analytics/compareData";
import { loadAnalytics } from "@/app/analytics/data";
import {
  ASSISTANT_SYSTEM_PROMPT,
  AssistantRequestSchema,
  chartContext,
  checkQuestion,
  explainChartMessage,
  explainCompareMessage,
  screenContextText,
  type AssistantResponse,
} from "@/lib/assistant";
import { CompareQuerySchema, invalidPairReason, type CompareResult } from "@/lib/compare";
import { requireOwner } from "@/lib/auth";
import { agentLimit } from "@/lib/agent/http";
import { agentErrorResponse, runAgent } from "@/lib/agent/run";
import { signalAfter } from "@/lib/live/signal";
import { clientIp } from "@/lib/rateLimit";

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

// POST /api/assistant  body: { days, messages, explain?, page?, view? }
// The analytics panel: a thin wrapper around the one agent (lib/agent/run.ts) on the "panel"
// surface, which adds show_chart. This route works out the period and what's on screen.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  // 1. Rate limit before doing any work.
  const limited = agentLimit(request, "panel");
  if (limited) return limited;

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

  // 5. What's on screen. The browser sent only chart ids; the numbers are looked up here.
  //    If the focused Compare chart fails to load, its title is still used.
  const period = digest.period;
  const contextLine =
    `Period: ${period.start} to ${period.end} (last ${days} days), compared with ${period.previous_start} to ${period.previous_end}. ` +
    `Restaurant: ${digest.restaurant}.`;
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

  // 6. Ask the agent. Every number and chart comes from the database through its tools.
  try {
    const result = await runAgent({
      surface: "panel",
      messages,
      identity: clientIp(request),
      page: req.page,
      instructions: ASSISTANT_SYSTEM_PROMPT,
      context: [contextLine, screenText].filter(Boolean).join("\n\n"),
      days,
      digest,
    });
    if (result.changes.length || result.order) signalAfter("/api/assistant");
    const body: AssistantResponse & Pick<typeof result, "changes" | "links" | "proposals"> = {
      answer: result.answer,
      charts: result.charts,
      changes: result.changes,
      links: result.links,
      proposals: result.proposals,
    };
    return Response.json(body);
  } catch (err) {
    return agentErrorResponse(err);
  }
}
