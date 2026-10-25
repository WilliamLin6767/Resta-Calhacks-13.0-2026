import { AiError } from "@/lib/purchasing/ai";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { scanMenuTrends } from "@/lib/trends/scan";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// One scan a minute. Yelp plus two social runs is a long Apify job.
export const maxDuration = 300;

const perVisitor = createRateLimiter({ limit: 1, windowMs: 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 1, windowMs: 60 * 1000 });

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function tooMany(retryAfterSeconds: number) {
  return errorResponse(
    `A trend scan just ran. Wait ${retryAfterSeconds} seconds so a second click doesn't start another run.`,
    429,
    { "Retry-After": String(retryAfterSeconds) },
  );
}

// POST /api/market/trends
// Finds dishes on Yelp and social posts, then keeps the ones that fit the current pantry.
// Does not write menu_items.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  if (!process.env.APIFY_TOKEN) {
    return errorResponse("APIFY_TOKEN is missing. Add it to the server env file. It is not sent to the browser.", 500);
  }

  const supabase = await getSupabase();
  const probe = await supabase.from("dish_recommendations").select("id").limit(1);
  if (probe.error) {
    const missing = /dish_recommendations|schema cache/i.test(probe.error.message);
    return errorResponse(
      missing ? `${probe.error.message} Has supabase/15_dish_recommendations.sql been run?` : probe.error.message,
      500,
    );
  }

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) return tooMany(visitor.retryAfterSeconds);
  const app = wholeApp("trends");
  if (!app.ok) return tooMany(app.retryAfterSeconds);
  const [restaurant, menu, pantry] = await Promise.all([
    supabase.from("restaurants").select("name, cuisine, address").eq("id", RESTAURANT_ID).maybeSingle(),
    supabase.from("menu_items").select("name").eq("restaurant_id", RESTAURANT_ID).eq("active", true),
    supabase.from("ingredients").select("name").eq("restaurant_id", RESTAURANT_ID),
  ]);
  if (restaurant.error) return errorResponse(restaurant.error.message, 500);
  if (menu.error) return errorResponse(menu.error.message, 500);
  if (pantry.error) return errorResponse(pantry.error.message, 500);

  let scan;
  try {
    scan = await scanMenuTrends(process.env.APIFY_TOKEN, {
      ownName: restaurant.data?.name ?? "Pho Berkeley",
      cuisine: restaurant.data?.cuisine ?? null,
      address: restaurant.data?.address ?? null,
      menuNames: (menu.data ?? []).map((row) => row.name),
      pantry: (pantry.data ?? []).map((row) => row.name),
    });
  } catch (err) {
    if (err instanceof AiError) return errorResponse(err.message, err.status);
    return errorResponse(err instanceof Error ? err.message : "Could not scan trends.", 502);
  }

  if (scan.recommendations.length === 0) {
    return Response.json({
      stored: 0,
      failures: scan.failures,
      message: "No dish cleared the menu check. Previous recommendations were left in place.",
    });
  }

  const scrapedAt = new Date().toISOString();
  const rows = scan.recommendations.map((dish) => ({
    restaurant_id: RESTAURANT_ID,
    dish_name: dish.dish_name,
    demand_score: dish.demand_score,
    fit_score: dish.fit_score,
    recommend_score: dish.recommend_score,
    new_ingredient_count: dish.new_ingredient_count,
    have_ingredients: dish.have_ingredients,
    new_ingredients: dish.new_ingredients,
    reason: dish.reason,
    evidence: dish.evidence,
    scraped_at: scrapedAt,
  }));
  const { error } = await supabase.from("dish_recommendations").insert(rows);
  if (error) {
    const missing = /dish_recommendations|schema cache/i.test(error.message);
    return errorResponse(
      missing ? `${error.message} Has supabase/15_dish_recommendations.sql been run?` : error.message,
      500,
    );
  }
  const { error: deleteError } = await supabase.from("dish_recommendations").delete().eq("restaurant_id", RESTAURANT_ID).lt("scraped_at", scrapedAt);
  if (deleteError) {
    return errorResponse(`Saved the new dishes but could not remove the previous ones: ${deleteError.message}`, 500);
  }

  return Response.json({
    stored: rows.length,
    failures: scan.failures,
    message: scan.failures.length > 0 ? scan.failures.join(" ") : undefined,
  });
}
