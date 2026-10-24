import sharp from "sharp";
import { ownPhotoPath, ownPhotoUrl } from "@/lib/marketing/photoPath";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

export const maxDuration = 30;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// POST /api/marketing/photo
// Replaces the picture on one draft with a photo the owner uploaded.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Send a photo.", 400);
  }
  const id = Number(form.get("id"));
  const file = form.get("file");
  if (!Number.isInteger(id) || id <= 0) return errorResponse("Send the post id.", 400);
  if (!(file instanceof File)) return errorResponse("Choose a photo.", 400);
  if (!file.type.startsWith("image/")) return errorResponse("Use a JPEG, PNG, or WebP photo.", 400);
  if (file.size > 8_000_000) return errorResponse("That photo is over 8 MB.", 400);

  const supabase = await getSupabase();
  const existing = await supabase.from("marketing_posts").select("id, status").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
  if (existing.error) return errorResponse(existing.error.message, 500);
  if (!existing.data) return errorResponse("That post is no longer here.", 404);
  if (existing.data.status === "posted") return errorResponse("This post was already sent.", 409);

  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(1080, 1080, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    return errorResponse("That file could not be read as a photo.", 400);
  }

  const uploaded = await supabase.storage.from("marketing").upload(ownPhotoPath(id), jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) return errorResponse(`${uploaded.error.message}. Has supabase/16_marketing.sql been run?`, 500);
  return Response.json({ url: `${ownPhotoUrl(id)}?v=${Date.now()}` });
}
