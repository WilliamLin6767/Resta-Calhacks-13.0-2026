import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AiReportSchema, parseDays, type Digest } from "@/lib/analytics";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// Change this one line to try a different Claude model.
const AI_MODEL = "claude-sonnet-5-5";

const SYSTEM_PROMPT =
  "You are a restaurant operations consultant explaining a dashboard to the owner of a small family restaurant. " +
  "You receive a JSON summary of their sales and costs. Explain what each section means in plain, friendly language without jargon. " +
  "Only use numbers that appear in the JSON, and never invent data. " +
  "If you estimate an impact, say it is an estimate and show the simple math. " +
  "Be specific to this restaurant and its menu. Keep each field short.";

// A saved report younger than this is reused instead of calling the AI again.
const REUSE_MINUTES = 5;

// This runs on the server only, so ANTHROPIC_API_KEY never reaches the browser.
// new Anthropic() reads the key from the environment (.env.local).
const anthropic = new Anthropic();

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// POST /api/analytics/report  body: { days: 7 | 30 | 60 }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const days = parseDays(body.days);

  const supabase = await getSupabase();

  // 0. Limit AI spending: if a report for this period was saved in the last
  //    few minutes, send that one back instead of paying for a new one.
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

  // 1. Get the numbers from the database. The SQL function does all the math.
  const { data, error } = await supabase.rpc("analytics_digest", {
    p_restaurant_id: RESTAURANT_ID,
    p_days: days,
  });
  if (error) return errorResponse(`Could not load analytics: ${error.message}`, 500);
  const digest = data as Digest;

  // 2. Drop the long day-by-day list. by_weekday already covers the weekly pattern.
  const digestForAi: Partial<Digest> = { ...digest };
  delete digestForAi.daily;

  // 3. Ask Claude. Structured outputs guarantee the reply matches AiReportSchema.
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

  // 4. Check why Claude stopped before reading the answer.
  if (response.stop_reason === "refusal") {
    return errorResponse("The AI declined to analyze this data.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    return errorResponse("The AI reply was cut off. Try again.", 502);
  }
  const report = response.parsed_output;
  if (!report) return errorResponse("The AI reply could not be read. Try again.", 502);

  // 5. Save it so page loads can show it without calling the AI again.
  const { error: saveError } = await supabase.from("ai_reports").insert({
    restaurant_id: RESTAURANT_ID,
    period_days: days,
    digest,
    report,
    model: response.model,
  });
  if (saveError) return errorResponse(`Report created but not saved: ${saveError.message}`, 500);

  return Response.json({ report, cached: false });
}
