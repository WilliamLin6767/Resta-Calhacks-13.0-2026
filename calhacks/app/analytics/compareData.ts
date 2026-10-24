import { cache } from "react";
import type { CompareQuery, CompareResult } from "@/lib/compare";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

export type CompareLoad = { result: CompareResult } | { error: string };

// cache() remembers results by argument, and an object is a new argument every time,
// so the cached function takes plain values.
const loadCompareCached = cache(async (metric: string, breakdown: string, days: number): Promise<CompareLoad> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("analytics_compare", {
    p_restaurant_id: RESTAURANT_ID,
    p_metric: metric,
    p_breakdown: breakdown,
    p_days: days,
  });
  if (error) return { error: error.message };
  return { result: data as CompareResult };
});

// One metric split by one breakdown. Called from server components and API routes only.
export function loadCompare({ metric, breakdown, days }: CompareQuery): Promise<CompareLoad> {
  return loadCompareCached(metric, breakdown, days);
}
