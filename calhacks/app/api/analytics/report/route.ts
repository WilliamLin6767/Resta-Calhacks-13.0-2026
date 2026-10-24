import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AiReportSchema, PERIOD_OPTIONS, type Digest } from "@/lib/analytics";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// Change this one line to try a different Claude model.
const AI_MODEL = "claude-sonnet-5-5";

const SYSTEM_PROMPT =
  "You are a restaurant operations consultant explaining a dashboard to the owner of a small family restaurant. " +
  "You receive a JSON summary of their sales and costs. Read its `notes` first: they explain how every number is calculated. " +
  "Explain what each section means in plain, friendly language without jargon. " +
  "Only use numbers that appear in the JSON, and never invent data. " +
  "When the number of open days differs between periods, compare revenue per open day, not total revenue. " +
  "Judge delivery channels by net revenue (what the restaurant keeps after platform fees), not gross revenue. " +
  "Do not suggest dropping a low-priced side, drink or dessert only because its menu class is \"dog\"; they are compared with mains. " +
  "If you estimate an impact, label it as an estimate and show the simple math. " +
  "Be specific to this restaurant and its menu. Keep each field short.";

// A saved report younger than this is reused instead of calling the AI again.
const REUSE_MINUTES = 5;

// Rate limits: 3 reports per visitor per 10 minutes, and 30 per day for the whole app.
const perVisitor = createRateLimiter({ limit: 3, windowMs: 10 * 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 30, windowMs: 24 * 60 * 60 * 1000 });

// This runs on the server only, so ANTHROPIC_API_KEY never reaches the browser.
// new Anthropic() reads the key from the environment (.env.local).
const anthropic = new Anthropic();

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function tooManyRequests(retryAfterSeconds: number, message: string) {
  return errorResponse(message, 429, { "Retry-After": String(retryAfterSeconds) });
}

// POST /api/analytics/report  body: { days: 7 | 30 | 60 }
export async function POST(request: Request) {
  // 0. Rate limit before doing any work.
  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) {
    const minutes = Math.ceil(visitor.retryAfterSeconds / 60);
    return tooManyRequests(visitor.retryAfterSeconds, `You've made 3 AI reports in 10 minutes. Try again in about ${minutes} min.`);
  }
  const app = wholeApp("all");
  if (!app.ok) {
    return tooManyRequests(app.retryAfterSeconds, "The app has reached today's limit of AI reports. Try again tomorrow.");
  }

  const body = await request.json().catch(() => ({}));
  const days = Number(body.days);
  if (!(PERIOD_OPTIONS as readonly number[]).includes(days)) {
    return errorResponse(`days must be one of ${PERIOD_OPTIONS.join(", ")}.`, 400);
  }

  const supabase = await getSupabase();

  // 1. If a report for this period was saved in the last few minutes, send that one back
  //    instead of paying for a new one.
  const { data: latest } = await supabase
    .from("ai_reports")
    .select("report, created_at")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("period_days", days)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    const minutesOld = (Date.now() - new Date(latest.created_at).getTime()) / 60000;
    if (minutesOld < REUSE_MINUTES) {
      return Response.json({
        report: latest.report,
        cached: true,
        message: `Showing the report from ${Math.max(1, Math.round(minutesOld))} min ago. You can make a new one ${REUSE_MINUTES} minutes after the last.`,
      });
    }
  }

  // 2. Get the numbers from the database. The SQL function does all the math.
  const { data, error } = await supabase.rpc("analytics_digest", {
    p_restaurant_id: RESTAURANT_ID,
    p_days: days,
  });
  if (error) return errorResponse(`Could not load analytics: ${error.message}`, 500);
  const digest = data as Digest;
  if (!digest.kpis.cur) return errorResponse(`There are no orders in the last ${days} days to analyze.`, 400);

  // 3. Drop the long day-by-day list (by_weekday covers the weekly pattern).
  //    This same digest is what gets saved, so staleness can be checked later.
  const digestForAi: Partial<Digest> = { ...digest };
  delete digestForAi.daily;

  // 4. Ask Claude. Structured outputs guarantee the reply matches AiReportSchema.
  let response;
  try {
    response = await anthropic.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      // If a safety check declines the request, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AiReportSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(digestForAi) }],
    });
  } catch (err) {
    // Most specific errors first.
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

  // 5. Check why Claude stopped before reading the answer.
  if (response.stop_reason === "refusal") {
    return errorResponse("The AI declined to analyze this data.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    return errorResponse("The AI reply was cut off. Try again.", 502);
  }
  const report = response.parsed_output;
  if (!report) return errorResponse("The AI reply could not be read. Try again.", 502);

  // 6. Save it so page loads can show it without calling the AI again.
  const { error: saveError } = await supabase.from("ai_reports").insert({
    restaurant_id: RESTAURANT_ID,
    period_days: days,
    digest: digestForAi,
    report,
    model: response.model,
  });
  if (saveError) return errorResponse(`Report created but not saved: ${saveError.message}`, 500);

  return Response.json({ report, cached: false });
}
