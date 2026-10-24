import { bufferConfig, publishToInstagram } from "@/lib/marketing/buffer";
import { captionFor, type PostLayout } from "@/lib/marketing/copy";
import { readPostEdit } from "@/lib/marketing/edit";
import { renderPostJpeg } from "@/lib/marketing/image";
import { loadPostPhoto } from "@/lib/marketing/photo";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

export const maxDuration = 60;

const perVisitor = createRateLimiter({ limit: 1, windowMs: 20 * 1000 });
const wholeApp = createRateLimiter({ limit: 8, windowMs: 24 * 60 * 60 * 1000 });

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

// POST /api/marketing/publish
// Renders one draft as a JPEG and sends it to Instagram through Buffer.
export async function POST(request: Request) {
  const config = bufferConfig();
  if ("error" in config) return errorResponse(config.error, 500);

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
    return errorResponse(`Wait ${visitor.retryAfterSeconds} seconds before posting another one.`, 429, {
      "Retry-After": String(visitor.retryAfterSeconds),
    });
  }
  const app = wholeApp("marketing-publish");
  if (!app.ok) return errorResponse("The daily posting limit for this demo has been reached.", 429);

  const supabase = await getSupabase();
  const { data: post, error } = await supabase
    .from("marketing_posts")
    .select("id, layout, dish_name, status")
    .eq("id", id)
    .eq("restaurant_id", RESTAURANT_ID)
    .maybeSingle();
  if (error) {
    const missing = /marketing_posts|schema cache/i.test(error.message);
    return errorResponse(missing ? `${error.message}. Has supabase/16_marketing.sql been run?` : error.message, 500);
  }
  if (!post) return errorResponse("That post is no longer here.", 404);
  if (post.status === "posted") return errorResponse("This post was already sent.", 409);

  const restaurant = await supabase.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle();
  if (restaurant.error) return errorResponse(restaurant.error.message, 500);

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

  let jpeg: Buffer;
  try {
    const photo = await loadPostPhoto(supabase, id, edit.dishName);
    jpeg = await renderPostJpeg(
      {
        layout: post.layout as PostLayout,
        restaurant: restaurant.data?.name ?? "Pho Berkeley",
        dishName: edit.dishName,
        headline: edit.headline,
        subhead: edit.subhead,
      },
      photo,
    );
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Could not render the image.", 500);
  }

  const path = `${RESTAURANT_ID}/${id}.jpg`;
  const uploaded = await supabase.storage.from("marketing").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) {
    return errorResponse(`${uploaded.error.message}. Has supabase/16_marketing.sql been run?`, 500);
  }
  const imageUrl = `${supabase.storage.from("marketing").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;

  let published;
  try {
    published = await publishToInstagram({
      text: captionFor(edit.caption, edit.hashtags),
      imageUrl,
      alt: `${edit.dishName}. ${edit.headline}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Buffer could not post this.";
    await supabase.from("marketing_posts").update({ status: "failed", error: message, image_path: path }).eq("id", id);
    return errorResponse(message, 502);
  }

  if (published.status === "error" || published.error) {
    const message = published.error ?? "Instagram rejected the post.";
    await supabase.from("marketing_posts").update({ status: "failed", error: message, buffer_post_id: published.id, image_path: path }).eq("id", id);
    return errorResponse(message, 502);
  }

  await supabase
    .from("marketing_posts")
    .update({
      status: "posted",
      buffer_post_id: published.id,
      external_link: published.externalLink,
      image_path: path,
      error: null,
      posted_at: new Date().toISOString(),
    })
    .eq("id", id);

  return Response.json({ id: published.id, status: published.status, externalLink: published.externalLink });
}
