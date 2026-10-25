import { reportLimit, runReport, type ReportResult } from "@/lib/analyticsReport";
import { clientIp } from "@/lib/rateLimit";
import { getSupabase } from "@/lib/supabase";

function respond(result: ReportResult) {
  if (result.ok) return Response.json(result.body);
  const headers = result.retryAfterSeconds !== undefined ? { "Retry-After": String(result.retryAfterSeconds) } : undefined;
  return Response.json({ error: result.error }, { status: result.status, headers });
}

// POST /api/analytics/report  body: { days: 7 | 30 | 60 }
// The AI report for the period (lib/analyticsReport.ts): reused if one was made in the last few minutes.
export async function POST(request: Request) {
  const limited = reportLimit(clientIp(request));
  if (limited) return respond(limited);
  const body = await request.json().catch(() => ({}));
  return respond(await runReport(await getSupabase(), Number(body.days)));
}
