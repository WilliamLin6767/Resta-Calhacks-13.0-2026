import type { Digest } from "@/lib/analytics";
import { explainMarket } from "@/lib/market/judge";
import { fetchUsdaMarket, pointsFromRows, quotesFromItems } from "@/lib/market/usda";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// One check per few minutes. The limiter is in memory, so it resets on restart.
const perVisitor = createRateLimiter({ limit: 1, windowMs: 3 * 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 1, windowMs: 3 * 60 * 1000 });

const QUOTE_COLUMNS = "report_id, commodity, class, price_unit, market_location, report_date, price_avg, ingredient_family";

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function tooMany(retryAfterSeconds: number) {
  return errorResponse(
    `A USDA check just ran. Wait ${retryAfterSeconds} seconds so a second click doesn't start another run.`,
    429,
    { "Retry-After": String(retryAfterSeconds) },
  );
}

// POST /api/market/usda
// Fetches the cached USDA livestock and dairy reports and stores them.
// Does not write supplier_prices.
export async function POST(request: Request) {
  if (!process.env.APIFY_TOKEN) {
    return errorResponse("APIFY_TOKEN is missing. Add it to the server env file. It is not sent to the browser.", 500);
  }

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) return tooMany(visitor.retryAfterSeconds);
  const app = wholeApp("usda");
  if (!app.ok) return tooMany(app.retryAfterSeconds);

  let fetched;
  try {
    fetched = await fetchUsdaMarket(process.env.APIFY_TOKEN);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach Apify.";
    return errorResponse(message, 502);
  }

  const createdAt = new Date().toISOString();
  const rows = quotesFromItems(fetched.items, fetched.cacheRefreshedAt, createdAt);
  const supabase = await getSupabase();

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("market_quotes").insert(rows.slice(i, i + 200));
      if (error) return errorResponse(`Could not save USDA quotes: ${error.message}`, 500);
    }
    const { error: deleteError } = await supabase.from("market_quotes").delete().eq("source", "usda_ams").lt("created_at", createdAt);
    if (deleteError) {
      return errorResponse(`Saved the new USDA quotes but could not remove the previous ones: ${deleteError.message}`, 500);
    }
  }

  const { data: stored, error: loadError } = await supabase.from("market_quotes").select(QUOTE_COLUMNS).eq("source", "usda_ams");
  if (loadError) return errorResponse(`Quotes saved, but could not be read back: ${loadError.message}`, 500);

  const digestResult = await supabase.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 });
  const digest = digestResult.data as Digest | null;
  const quotes = pointsFromRows(stored ?? []);
  const verdicts = (digest?.price_changes ?? [])
    .filter((change) => change.change_pct > 0)
    .map((change) => ({
      ingredient: change.ingredient,
      supplierChangePct: change.change_pct,
      ...explainMarket({
        ingredient: change.ingredient,
        supplierChangePct: change.change_pct,
        since: change.since,
        quotes,
      }),
    }));

  return Response.json({
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
  });
}
