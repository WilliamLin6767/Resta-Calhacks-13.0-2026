import { cache } from "react";
import type { AiReport, Digest } from "@/lib/analytics";
import { isReportStale } from "@/lib/insights";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

export type AnalyticsLoad =
  | { digest: Digest; report: AiReport | null; stale: boolean; savedAt: string | null; model: string | null }
  | { error: string };

// Everything the Analytics pages and the assistant need for one period: the digest and the
// newest saved AI report, loaded in parallel. cache() means a request that asks twice only
// queries once.
export const loadAnalytics = cache(async (days: number): Promise<AnalyticsLoad> => {
  const supabase = await getSupabase();
  const [digestResult, reportResult] = await Promise.all([
    supabase.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: days }),
    supabase
      .from("ai_reports")
      .select("report, digest, model, created_at")
      .eq("restaurant_id", RESTAURANT_ID)
      .eq("period_days", days)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (digestResult.error) return { error: digestResult.error.message };

  const digest = digestResult.data as Digest;
  const saved = reportResult.data;
  return {
    digest,
    report: (saved?.report as AiReport | undefined) ?? null,
    // Out of date when the numbers it was written from no longer match today's.
    stale: isReportStale(saved?.digest as Partial<Digest> | undefined, digest),
    savedAt: saved?.created_at ?? null,
    model: saved?.model ?? null,
  };
});
