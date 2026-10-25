// Publishing one post to Instagram through Buffer (server only). The executor behind the
// publish_post action (lib/agent/executors.ts); the Marketing page's Publish button goes through
// the same approval gate. The post is claimed first (status 'publishing', where it was a draft
// or failed), so a double tap or two open tabs can't post it twice.
import type { SupabaseClient } from "@supabase/supabase-js";
import { bufferConfig, publishToInstagram } from "@/lib/marketing/buffer";
import { captionFor, type PostLayout } from "@/lib/marketing/copy";
import type { PostEdit } from "@/lib/marketing/edit";
import { renderPostJpeg } from "@/lib/marketing/image";
import { loadPostPhoto } from "@/lib/marketing/photo";
import { RESTAURANT_ID } from "@/lib/supabase";

export class PublishError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const setupHint = (message: string) => (/marketing_posts|schema cache/i.test(message) ? `${message}. Has supabase/16_marketing.sql been run?` : message);

type Post = { id: number; layout: string; dish_name: string; headline: string; subhead: string; caption: string; hashtags: string[]; status: string; credit?: string | null };

// Takes the post for this publish: draft or failed -> publishing. Null when it wasn't free
// (already posted, or another publish has it). Before 20_marketing_status.sql adds the
// 'publishing' status, the database refuses it; then the old check (not posted yet) is used.
async function claim(db: SupabaseClient, id: number): Promise<Post | null> {
  const res = await db
    .from("marketing_posts")
    .update({ status: "publishing", error: null })
    .eq("id", id)
    .eq("restaurant_id", RESTAURANT_ID)
    .in("status", ["draft", "failed"])
    .select("*")
    .maybeSingle();
  if (!res.error) return (res.data as Post | null) ?? null;
  if (!/marketing_posts_status|check constraint/i.test(res.error.message)) throw new PublishError(setupHint(res.error.message), 500);
  const old = await db.from("marketing_posts").select("*").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
  if (old.error) throw new PublishError(setupHint(old.error.message), 500);
  const post = old.data as Post | null;
  return post && post.status !== "posted" ? post : null;
}

export async function publishPost(db: SupabaseClient, id: number, edit?: PostEdit) {
  const config = bufferConfig();
  if ("error" in config) throw new PublishError(config.error, 500);

  const existing = await db.from("marketing_posts").select("id, status").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
  if (existing.error) throw new PublishError(setupHint(existing.error.message), 500);
  if (!existing.data) throw new PublishError("That post is no longer here.", 404);
  if (existing.data.status === "posted") throw new PublishError("This post was already sent.", 409);

  // The owner's last edits, saved before the claim so they're kept even if Buffer fails
  if (edit) {
    const saved = await db
      .from("marketing_posts")
      .update({ dish_name: edit.dishName, headline: edit.headline, subhead: edit.subhead, caption: edit.caption, hashtags: edit.hashtags, error: null })
      .eq("id", id)
      .eq("restaurant_id", RESTAURANT_ID)
      .neq("status", "posted");
    if (saved.error) throw new PublishError(saved.error.message, 500);
  }

  const post = await claim(db, id);
  if (!post) throw new PublishError("This post is already being sent, or was sent.", 409);
  const markFailed = (message: string, extra: Record<string, unknown> = {}) =>
    db.from("marketing_posts").update({ status: "failed", error: message, ...extra }).eq("id", id);

  const restaurant = await db.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle();
  let jpeg: Buffer;
  try {
    const photo = await loadPostPhoto(db, id, post.dish_name);
    jpeg = await renderPostJpeg(
      { layout: post.layout as PostLayout, restaurant: restaurant.data?.name ?? "Pho Berkeley", dishName: post.dish_name, headline: post.headline, subhead: post.subhead },
      photo,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not render the image.";
    await markFailed(message);
    throw new PublishError(message, 500);
  }

  const path = `${RESTAURANT_ID}/${id}.jpg`;
  const uploaded = await db.storage.from("marketing").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) {
    const message = `${uploaded.error.message}. Has supabase/16_marketing.sql been run?`;
    await markFailed(message);
    throw new PublishError(message, 500);
  }
  const imageUrl = `${db.storage.from("marketing").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  // A stock photo's credit goes into the caption (lib/marketing/photo.ts)
  const caption = post.credit ? `${post.caption}\n\n${post.credit}` : post.caption;

  let published;
  try {
    published = await publishToInstagram({ text: captionFor(caption, post.hashtags), imageUrl, alt: `${post.dish_name}. ${post.headline}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Buffer could not post this.";
    await markFailed(message, { image_path: path });
    throw new PublishError(message, 502);
  }
  if (published.status === "error" || published.error) {
    const message = published.error ?? "Instagram rejected the post.";
    await markFailed(message, { buffer_post_id: published.id, image_path: path });
    throw new PublishError(message, 502);
  }

  await db
    .from("marketing_posts")
    .update({ status: "posted", buffer_post_id: published.id, external_link: published.externalLink, image_path: path, error: null, posted_at: new Date().toISOString() })
    .eq("id", id);
  return { id: published.id, status: published.status, externalLink: published.externalLink, post_id: id, dish: post.dish_name };
}
