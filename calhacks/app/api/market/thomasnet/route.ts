import type { Digest } from "@/lib/analytics";
import { leadsFromItems } from "@/lib/market/leads";
import { searchThomasNet } from "@/lib/market/thomasnet";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// One search pass every 30 seconds. Several ingredients run inside that one pass.
const perVisitor = createRateLimiter({ limit: 1, windowMs: 30 * 1000 });
const wholeApp = createRateLimiter({ limit: 1, windowMs: 30 * 1000 });

const MAX_INGREDIENTS = 6;

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function tooMany(retryAfterSeconds: number) {
  return errorResponse(
    `A supplier search just ran. Wait ${retryAfterSeconds} seconds so a second click doesn't start another run.`,
    429,
    { "Retry-After": String(retryAfterSeconds) },
  );
}

// POST /api/market/thomasnet
// Finds outside companies with a phone for ingredients whose price jumped.
// Area CN is California North. Does not write suppliers or place a call.
export async function POST(request: Request) {
  if (!process.env.APIFY_TOKEN) {
    return errorResponse("APIFY_TOKEN is missing. Add it to the server env file. It is not sent to the browser.", 500);
  }
  const token = process.env.APIFY_TOKEN;

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) return tooMany(visitor.retryAfterSeconds);
  const app = wholeApp("thomasnet");
  if (!app.ok) return tooMany(app.retryAfterSeconds);

  const supabase = await getSupabase();
  const digestResult = await supabase.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 });
  if (digestResult.error) return errorResponse(`Could not load price changes: ${digestResult.error.message}`, 500);
  const digest = digestResult.data as Digest | null;
  const ingredients = (digest?.price_changes ?? [])
    .filter((change) => change.change_pct > 0)
    .sort((a, b) => (b.est_period_impact ?? 0) - (a.est_period_impact ?? 0))
    .slice(0, MAX_INGREDIENTS)
    .map((change) => change.ingredient);

  const scrapedAt = new Date().toISOString();
  const leads = [];
  const failures: string[] = [];
  for (const ingredient of ingredients) {
    try {
      const items = await searchThomasNet(token, ingredient);
      leads.push(...leadsFromItems(ingredient, items, scrapedAt));
    } catch (err) {
      failures.push(`${ingredient}: ${err instanceof Error ? err.message : "search failed"}`);
    }
  }

  if (leads.length === 0 && failures.length === ingredients.length && ingredients.length > 0) {
    return errorResponse(failures[0], 502);
  }

  if (leads.length > 0) {
    const { error } = await supabase.from("supplier_leads").insert(leads);
    if (error) return errorResponse(`Could not save supplier leads: ${error.message}`, 500);
    const { error: deleteError } = await supabase.from("supplier_leads").delete().eq("source", "thomasnet").lt("scraped_at", scrapedAt);
    if (deleteError) {
      return errorResponse(`Saved the new leads but could not remove the previous ones: ${deleteError.message}`, 500);
    }
  }

  return Response.json({
    searched: ingredients,
    stored: leads.length,
    failures,
    message:
      leads.length === 0
        ? "No food supplier with a phone matched those ingredients. Previous leads were left in place."
        : undefined,
  });
}
