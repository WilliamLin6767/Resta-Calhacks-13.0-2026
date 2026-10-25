import { AiError } from "@/lib/purchasing/ai";
import { draftPosts, voiceFor } from "@/lib/marketing/draft";
import { BRAVE_IMAGE_REJECTED, BRAVE_IMAGE_SETUP, braveImageConfig, saveFreshPhoto } from "@/lib/marketing/photo";
import { ownPhotoPath } from "@/lib/marketing/photoPath";
import { planWeek, type MenuPerformance } from "@/lib/marketing/targets";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

export const maxDuration = 180;

const perVisitor = createRateLimiter({ limit: 1, windowMs: 60 * 1000 });
const wholeApp = createRateLimiter({ limit: 1, windowMs: 60 * 1000 });

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

function tooMany(retryAfterSeconds: number) {
  return errorResponse(`A draft just ran. Wait ${retryAfterSeconds} seconds before writing another set.`, 429, {
    "Retry-After": String(retryAfterSeconds),
  });
}

const MENU_CLASSES = new Set(["star", "plowhorse", "puzzle", "dog"]);

function menuPerformance(rows: unknown, fallbackNames: string[]): MenuPerformance[] {
  const parsed: MenuPerformance[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof (row as { name?: unknown }).name !== "string") continue;
      const item = row as { name: string; units?: number; units_change_pct?: number | null; class?: string | null };
      parsed.push({
        name: item.name,
        units: Number(item.units ?? 0),
        units_change_pct: typeof item.units_change_pct === "number" ? item.units_change_pct : null,
        class: item.class && MENU_CLASSES.has(item.class) ? (item.class as MenuPerformance["class"]) : null,
      });
    }
  }
  if (parsed.length > 0) return parsed;
  return fallbackNames.map((name) => ({ name, units: 0, units_change_pct: null, class: null }));
}

function imageRejection(reason: unknown): string | null {
  const message = reason instanceof Error ? reason.message : "";
  if (message === BRAVE_IMAGE_REJECTED || message === BRAVE_IMAGE_SETUP) return message;
  return null;
}

// POST /api/marketing/draft
// One post pushes a quiet dish from Analytics. The others poll dishes from Trends.

export async function POST(request: Request) {
  const images = braveImageConfig();
  if ("error" in images) return errorResponse(images.error, 500);

  const supabase = await getSupabase();
  const probe = await supabase.from("marketing_posts").select("id").limit(1);
  if (probe.error) {
    const missing = /marketing_posts|schema cache/i.test(probe.error.message);
    return errorResponse(missing ? `${probe.error.message}. Has supabase/16_marketing.sql been run?` : probe.error.message, 500);
  }

  const usedPhotos = await supabase.from("marketing_used_photos").select("source_url, dish_name").order("used_at", { ascending: false }).limit(300);
  if (usedPhotos.error) {
    const missing = /marketing_used_photos|schema cache/i.test(usedPhotos.error.message);
    return errorResponse(missing ? `${usedPhotos.error.message}. Has supabase/17_marketing_photo.sql been run?` : usedPhotos.error.message, 500);
  }

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) return tooMany(visitor.retryAfterSeconds);
  const app = wholeApp("marketing-draft");
  if (!app.ok) return tooMany(app.retryAfterSeconds);

  const [restaurant, menu, recommendations, digest] = await Promise.all([
    supabase.from("restaurants").select("name, cuisine, address").eq("id", RESTAURANT_ID).maybeSingle(),
    supabase.from("menu_items").select("name").eq("restaurant_id", RESTAURANT_ID).eq("active", true).order("name"),
    supabase.from("dish_recommendations").select("dish_name, recommend_score").eq("restaurant_id", RESTAURANT_ID).order("recommend_score", { ascending: false }).limit(8),
    supabase.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
  ]);
  if (restaurant.error) return errorResponse(restaurant.error.message, 500);
  if (menu.error) return errorResponse(menu.error.message, 500);
  if (!menu.data?.length) return errorResponse("Add a dish to the menu before drafting posts.", 400);

  const digestMenu = digest.error ? [] : ((digest.data as { menu?: unknown } | null)?.menu ?? []);
  const offset = Math.floor(Date.now() / 1000);
  const slots = planWeek(
    menuPerformance(digestMenu, menu.data.map((item) => item.name)),
    recommendations.error ? [] : (recommendations.data ?? []).map((item) => item.dish_name),
    offset,
  );
  if (slots.length === 0) return errorResponse("No dishes to post about yet.", 400);

  let posts;
  try {
    posts = await draftPosts({
      name: restaurant.data?.name ?? "Pho Berkeley",
      cuisine: restaurant.data?.cuisine ?? null,
      address: restaurant.data?.address ?? null,
      slots,
      voice: voiceFor(offset),
    });
  } catch (err) {
    if (err instanceof AiError) return errorResponse(err.message, err.status);
    return errorResponse(err instanceof Error ? err.message : "Could not draft posts.", 502);
  }

  const stale = await supabase.from("marketing_posts").select("id").eq("restaurant_id", RESTAURANT_ID).neq("status", "posted");
  if (stale.error) return errorResponse(stale.error.message, 500);
  const staleIds = (stale.data ?? []).map((row) => row.id);
  if (staleIds.length > 0) {
    const removed = await supabase.from("marketing_posts").delete().in("id", staleIds);
    if (removed.error) return errorResponse(removed.error.message, 500);
    await supabase.storage.from("marketing").remove(staleIds.map((id) => ownPhotoPath(id)));
  }

  const inserted = await supabase
    .from("marketing_posts")
    .insert(
      posts.map((post) => ({
        restaurant_id: RESTAURANT_ID,
        layout: post.layout,
        dish_name: post.dish_name,
        headline: post.headline,
        subhead: post.subhead,
        caption: post.caption,
        hashtags: post.hashtags,
        status: "draft",
      })),
    )
    .select("id, dish_name");
  if (inserted.error) return errorResponse(inserted.error.message, 500);

  const usedByDish = new Map<string, string[]>();
  for (const row of usedPhotos.data ?? []) {
    const list = usedByDish.get(row.dish_name) ?? [];
    list.push(row.source_url);
    usedByDish.set(row.dish_name, list);
  }
  const cuisine = restaurant.data?.cuisine ?? null;
  const photos = await Promise.allSettled(
    (inserted.data ?? []).map((row) => saveFreshPhoto(supabase, row.id, row.dish_name, cuisine, usedByDish.get(row.dish_name) ?? [])),
  );
  const failures = photos.flatMap((result) => {
    if (result.status !== "rejected") return [];
    const message = imageRejection(result.reason);
    return message ? [message] : [];
  });
  if (photos.length > 0 && failures.length === photos.length) {
    const ids = (inserted.data ?? []).map((row) => row.id);
    await supabase.from("marketing_posts").delete().in("id", ids);
    await supabase.storage.from("marketing").remove(ids.map((id) => ownPhotoPath(id)));
    return errorResponse(failures[0], 502);
  }
  return Response.json({ stored: posts.length });
}
