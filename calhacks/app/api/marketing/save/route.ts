import { readPostEdit } from "@/lib/marketing/edit";
import { ensureDishPhoto } from "@/lib/marketing/photo";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

const perVisitor = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

// POST /api/marketing/save
// Stores edits to a draft. Does not publish.
export async function POST(request: Request) {
  let body: { id?: unknown } & Parameters<typeof readPostEdit>[0];
  try {
    body = await request.json();
  } catch {
    return errorResponse("Send the edited post.", 400);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("Send the post id.", 400);
  const edit = readPostEdit(body);
  if ("error" in edit) return errorResponse(edit.error, 400);

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) {
    return errorResponse(`Wait ${visitor.retryAfterSeconds} seconds before saving again.`, 429, {
      "Retry-After": String(visitor.retryAfterSeconds),
    });
  }

  const supabase = await getSupabase();
  const existing = await supabase.from("marketing_posts").select("id, status, dish_name").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
  if (existing.error) return errorResponse(existing.error.message, 500);
  if (!existing.data) return errorResponse("That post is no longer here.", 404);
  if (existing.data.status === "posted") return errorResponse("This post was already sent.", 409);

  if (existing.data.dish_name !== edit.dishName) {
    await ensureDishPhoto(supabase, edit.dishName).catch(() => null);
  }

  const saved = await supabase
    .from("marketing_posts")
    .update({
      dish_name: edit.dishName,
      headline: edit.headline,
      subhead: edit.subhead,
      caption: edit.caption,
      hashtags: edit.hashtags,
      error: null,
    })
    .eq("id", id)
    .eq("restaurant_id", RESTAURANT_ID);
  if (saved.error) return errorResponse(saved.error.message, 500);
  return Response.json({ ok: true, hashtags: edit.hashtags });
}
