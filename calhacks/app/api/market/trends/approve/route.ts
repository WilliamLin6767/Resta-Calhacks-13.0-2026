import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { isOnMenu } from "@/lib/trends/score";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

const perVisitor = createRateLimiter({ limit: 10, windowMs: 60 * 1000 });

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function typicalPrice(prices: number[]): number {
  const values = prices.filter((price) => price > 0).sort((a, b) => a - b);
  if (values.length === 0) return 14.95;
  const mid = values[Math.floor((values.length - 1) / 2)];
  return Math.round(mid * 100) / 100;
}

// POST /api/market/trends/approve
// Puts one recommended dish on the menu. The owner can change the price later.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  let body: { dish_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("Send the dish name.", 400);
  }
  const dishName = typeof body.dish_name === "string" ? body.dish_name.trim() : "";
  if (!dishName) return errorResponse("Send the dish name.", 400);

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) {
    return errorResponse(`Wait ${visitor.retryAfterSeconds} seconds before adding another dish.`, 429, {
      "Retry-After": String(visitor.retryAfterSeconds),
    });
  }

  const supabase = await getSupabase();
  const [recommendation, menu] = await Promise.all([
    supabase.from("dish_recommendations").select("dish_name").eq("restaurant_id", RESTAURANT_ID).eq("dish_name", dishName).maybeSingle(),
    supabase.from("menu_items").select("name, price").eq("restaurant_id", RESTAURANT_ID).eq("active", true),
  ]);
  if (recommendation.error) return errorResponse(recommendation.error.message, 500);
  if (menu.error) return errorResponse(menu.error.message, 500);
  if (!recommendation.data) return errorResponse("That dish is not in the latest trend scan.", 404);

  const names = (menu.data ?? []).map((item) => item.name);
  if (isOnMenu(dishName, names)) return Response.json({ name: dishName, already: true });

  const price = typicalPrice((menu.data ?? []).map((item) => Number(item.price)));
  const inserted = await supabase
    .from("menu_items")
    .insert({ restaurant_id: RESTAURANT_ID, name: dishName, category: "New", price, active: true })
    .select("id, name, price")
    .single();
  if (inserted.error) return errorResponse(inserted.error.message, 500);
  return Response.json({ id: inserted.data.id, name: inserted.data.name, price: Number(inserted.data.price), already: false });
}
