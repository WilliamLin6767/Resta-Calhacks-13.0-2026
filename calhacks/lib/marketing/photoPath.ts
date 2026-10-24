// The public JPEG for a dish. The path is derived from the name, so the page and the publisher agree without a new column.

export function dishSlug(dish: string): string {
  const slug = dish
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "dish";
}

export function dishPhotoPath(dish: string): string {
  return `photos/${dishSlug(dish)}.jpg`;
}

export function dishPhotoUrl(dish: string): string {
  return publicPhotoUrl(dishPhotoPath(dish));
}

// A picture the owner uploaded for one post, kept apart from the shared dish photo.
export function ownPhotoPath(id: number): string {
  return `posts/${id}.jpg`;
}

export function ownPhotoUrl(id: number): string {
  return publicPhotoUrl(ownPhotoPath(id));
}

function publicPhotoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return "";
  return `${base}/storage/v1/object/public/marketing/${path}`;
}
