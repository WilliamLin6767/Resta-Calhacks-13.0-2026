// Refreshing market data through Apify (server only), shared by POST /api/market/usda,
// POST /api/market/thomasnet and the chat agent's refresh_market_prices. The rate limits live
// here so the routes and the agent count against the same ones.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Digest } from "@/lib/analytics";
import { explainMarket } from "@/lib/market/judge";
import { leadsFromItems } from "@/lib/market/leads";
import { searchThomasNet } from "@/lib/market/thomasnet";
import { fetchUsdaMarket, pointsFromRows, quotesFromItems } from "@/lib/market/usda";
import { createRateLimiter } from "@/lib/rateLimit";
import { RESTAURANT_ID } from "@/lib/supabase";

type Db = SupabaseClient;

export type Refreshed = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string; retryAfterSeconds?: number };

const fail = (status: number, error: string, retryAfterSeconds?: number): Refreshed => ({ ok: false, status, error, retryAfterSeconds });

// ---------- USDA livestock and dairy quotes ----------

// One check per few minutes. The limiter is in memory, so it resets on restart.
const usdaPerVisitor = createRateLimiter({ limit: 1, windowMs: 3 * 60 * 1000 });
const usdaWholeApp = createRateLimiter({ limit: 1, windowMs: 3 * 60 * 1000 });

export const QUOTE_COLUMNS = "report_id, commodity, class, price_unit, market_location, report_date, price_avg, ingredient_family";

// Fetches the cached USDA livestock and dairy reports and stores them. Does not write supplier_prices.
export async function refreshUsda(db: Db, identity: string): Promise<Refreshed> {
  if (!process.env.APIFY_TOKEN) return fail(500, "APIFY_TOKEN is missing. Add it to the server env file. It is not sent to the browser.");
  // One at a time, so a visitor over their limit doesn't use up the app's
  for (const check of [() => usdaPerVisitor(identity), () => usdaWholeApp("usda")]) {
    const result = check();
    if (!result.ok) {
      return fail(429, `A USDA check just ran. Wait ${result.retryAfterSeconds} seconds so a second click doesn't start another run.`, result.retryAfterSeconds);
    }
  }

  let fetched;
  try {
    fetched = await fetchUsdaMarket(process.env.APIFY_TOKEN);
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Could not reach Apify.");
  }

  const createdAt = new Date().toISOString();
  const rows = quotesFromItems(fetched.items, fetched.cacheRefreshedAt, createdAt);
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("market_quotes").insert(rows.slice(i, i + 200));
      if (error) return fail(500, `Could not save USDA quotes: ${error.message}`);
    }
    const { error: deleteError } = await db.from("market_quotes").delete().eq("source", "usda_ams").lt("created_at", createdAt);
    if (deleteError) return fail(500, `Saved the new USDA quotes but could not remove the previous ones: ${deleteError.message}`);
  }

  const { data: stored, error: loadError } = await db.from("market_quotes").select(QUOTE_COLUMNS).eq("source", "usda_ams");
  if (loadError) return fail(500, `Quotes saved, but could not be read back: ${loadError.message}`);

  const digestResult = await db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 });
  const digest = digestResult.data as Digest | null;
  const quotes = pointsFromRows(stored ?? []);
  const verdicts = (digest?.price_changes ?? [])
    .filter((change) => change.change_pct > 0)
    .map((change) => ({
      ingredient: change.ingredient,
      supplierChangePct: change.change_pct,
      ...explainMarket({ ingredient: change.ingredient, supplierChangePct: change.change_pct, since: change.since, quotes }),
    }));

  return {
    ok: true,
    body: {
      stored: rows.length,
      keptPrevious: rows.length === 0,
      cacheRefreshedAt: fetched.cacheRefreshedAt,
      slugsCovered: fetched.slugsCovered,
      verdicts,
      message:
        rows.length === 0
          ? `Those report slugs returned no cattle or dairy prices. Previous quotes were left in place.${
              fetched.slugsCovered.length ? ` Cache covers ${fetched.slugsCovered.slice(0, 12).join(", ")}.` : ""
            }`
          : undefined,
    },
  };
}

// ---------- ThomasNet supplier leads ----------

// One search pass every 30 seconds. Several ingredients run inside that one pass.
const leadsPerVisitor = createRateLimiter({ limit: 1, windowMs: 30 * 1000 });
const leadsWholeApp = createRateLimiter({ limit: 1, windowMs: 30 * 1000 });

const MAX_INGREDIENTS = 6;

// Finds outside companies with a phone for ingredients whose price jumped. Area CN is California
// North. Does not write suppliers or place a call.
export async function refreshThomasNet(db: Db, identity: string): Promise<Refreshed> {
  if (!process.env.APIFY_TOKEN) return fail(500, "APIFY_TOKEN is missing. Add it to the server env file. It is not sent to the browser.");
  const token = process.env.APIFY_TOKEN;
  // One at a time, so a visitor over their limit doesn't use up the app's
  for (const check of [() => leadsPerVisitor(identity), () => leadsWholeApp("thomasnet")]) {
    const result = check();
    if (!result.ok) {
      return fail(429, `A supplier search just ran. Wait ${result.retryAfterSeconds} seconds so a second click doesn't start another run.`, result.retryAfterSeconds);
    }
  }

  const digestResult = await db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 });
  if (digestResult.error) return fail(500, `Could not load price changes: ${digestResult.error.message}`);
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

  if (leads.length === 0 && failures.length === ingredients.length && ingredients.length > 0) return fail(502, failures[0]);

  if (leads.length > 0) {
    const { error } = await db.from("supplier_leads").insert(leads);
    if (error) return fail(500, `Could not save supplier leads: ${error.message}`);
    const { error: deleteError } = await db.from("supplier_leads").delete().eq("source", "thomasnet").lt("scraped_at", scrapedAt);
    if (deleteError) return fail(500, `Saved the new leads but could not remove the previous ones: ${deleteError.message}`);
  }

  return {
    ok: true,
    body: {
      searched: ingredients,
      stored: leads.length,
      failures,
      message: leads.length === 0 ? "No food supplier with a phone matched those ingredients. Previous leads were left in place." : undefined,
    },
  };
}

// A route's answer for a refresh result.
export function refreshResponse(result: Refreshed) {
  if (result.ok) return Response.json(result.body);
  const headers = result.retryAfterSeconds !== undefined ? { "Retry-After": String(result.retryAfterSeconds) } : undefined;
  return Response.json({ error: result.error }, { status: result.status, headers });
}
