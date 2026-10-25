import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dishPhotoPath, dishPhotoUrl, ownPhotoPath } from "@/lib/marketing/photoPath";
import { RESTAURANT_ID } from "@/lib/supabase";

// Openverse result fields we use. Licenses like CC BY need the creator credited, so the credit
// travels with the photo (on the post, and next to the shared dish photo).
type Hit = { title?: string; url?: string; width?: number; creator?: string | null; license?: string | null; license_version?: string | null; foreign_landing_url?: string | null };

export type PhotoCredit = { creator: string | null; license: string; source_url: string | null };
export type FoundPhoto = { bytes: Buffer; credit: PhotoCredit };

// "by" + "2.0" -> "CC BY 2.0"; cc0 and pdm have their own names.
export function licenseLabel(license: string | null | undefined, version?: string | null): string {
  const code = (license ?? "").toLowerCase();
  if (code === "cc0") return "CC0";
  if (code === "pdm") return "Public Domain Mark";
  if (!code) return "license unknown";
  return `CC ${code.toUpperCase()}${version ? ` ${version}` : ""}`;
}

// The line added to the caption: "Photo: Jane Doe, CC BY 2.0"
export function creditLine(credit: PhotoCredit): string {
  return `Photo: ${credit.creator?.trim() || "unknown creator"}, ${credit.license}`;
}

const creditOf = (hit: Hit): PhotoCredit => ({ creator: hit.creator ?? null, license: licenseLabel(hit.license, hit.license_version), source_url: hit.foreign_landing_url ?? null });

function words(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function rank(title: string, dish: string): number {
  const wanted = new Set(words(dish));
  return words(title).filter((word) => wanted.has(word)).length;
}

async function search(query: string): Promise<Hit[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", query);
  // Licenses that allow a restaurant to crop the photo and put type on it.
  url.searchParams.set("license", "cc0,pdm,by,by-sa");
  url.searchParams.set("page_size", "10");
  const response = await fetch(url, {
    headers: { "User-Agent": "RestaCalhacks/1.0 (restaurant marketing demo)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { results?: Hit[] };
  return body.results ?? [];
}

async function download(url: string): Promise<Buffer | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": "RestaCalhacks/1.0 (restaurant marketing demo)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8_000) return null;
  try {
    await sharp(bytes).metadata();
  } catch {
    return null;
  }
  return bytes;
}

async function firstPhoto(query: string, dish: string, requireMatch: boolean): Promise<FoundPhoto | null> {
  let hits: Hit[] = [];
  try {
    hits = await search(query);
  } catch {
    return null;
  }
  const ranked = hits
    .filter((hit) => hit.url && (hit.width ?? 0) >= 500)
    .sort((a, b) => rank(b.title ?? "", dish) - rank(a.title ?? "", dish));
  for (const hit of ranked) {
    if (requireMatch && rank(hit.title ?? "", dish) === 0) continue;
    try {
      const bytes = await download(hit.url!);
      if (bytes) return { bytes, credit: creditOf(hit) };
    } catch {
      continue;
    }
  }
  return null;
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const shift = ((by % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

// A food photo for the dish, with its credit. `salt` starts at a different search result so a
// new draft is not the same picture.
export async function findDishPhoto(dish: string, salt = 0): Promise<FoundPhoto | null> {
  const queries = rotate([`${dish} food`, `${dish} bowl`, `${dish} restaurant`, dish], salt);
  const hits: Hit[] = [];
  for (const query of queries.slice(0, 2)) {
    try {
      hits.push(...(await search(query)));
    } catch {
      // try the next wording
    }
  }
  const seen = new Set<string>();
  const usable = hits.filter((hit) => {
    if (!hit.url || (hit.width ?? 0) < 500 || seen.has(hit.url)) return false;
    seen.add(hit.url);
    return true;
  });
  const ranked = [...usable.filter((hit) => rank(hit.title ?? "", dish) > 0), ...usable.filter((hit) => rank(hit.title ?? "", dish) === 0)];
  const order = rotate(ranked, salt);
  for (const hit of order) {
    try {
      const bytes = await download(hit.url!);
      if (bytes) return { bytes, credit: creditOf(hit) };
    } catch {
      continue;
    }
  }
  return firstPhoto("vietnamese food bowl", dish, false);
}

// The shared dish photo's credit sits next to it as JSON.
const creditPath = (path: string) => `${path}.credit.json`;

// Saves the dish photo in the public marketing bucket and returns its URL. Reuses a photo already saved for that dish.
export async function ensureDishPhoto(supabase: SupabaseClient, dish: string): Promise<string | null> {
  const path = dishPhotoPath(dish);
  const existing = await supabase.storage.from("marketing").download(path);
  if (!existing.error && existing.data) return dishPhotoUrl(dish);

  const found = await findDishPhoto(dish);
  if (!found) return null;
  const jpeg = await sharp(found.bytes).rotate().resize(1080, 1080, { fit: "cover", position: "centre" }).jpeg({ quality: 86 }).toBuffer();
  const uploaded = await supabase.storage.from("marketing").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) return null;
  await supabase.storage.from("marketing").upload(creditPath(path), JSON.stringify(found.credit), { contentType: "application/json", upsert: true });
  return dishPhotoUrl(dish);
}

async function storedPhoto(supabase: SupabaseClient, path: string): Promise<Buffer | undefined> {
  const file = await supabase.storage.from("marketing").download(path);
  if (file.error || !file.data) return undefined;
  return Buffer.from(await file.data.arrayBuffer());
}

async function storedCredit(supabase: SupabaseClient, path: string): Promise<PhotoCredit | null> {
  const file = await supabase.storage.from("marketing").download(creditPath(path));
  if (file.error || !file.data) return null;
  try {
    return JSON.parse(await file.data.text()) as PhotoCredit;
  } catch {
    return null;
  }
}

// Records where a post's photo came from. Before 20_marketing_status.sql adds the columns this
// write fails, and the post simply has no credit recorded.
export async function recordPhoto(supabase: SupabaseClient, id: number, source: "owner" | "stock", credit: PhotoCredit | null) {
  await supabase
    .from("marketing_posts")
    .update({
      photo_source: source,
      photo_creator: credit?.creator ?? null,
      photo_license: credit?.license ?? null,
      photo_source_url: credit?.source_url ?? null,
      credit: source === "stock" && credit ? creditLine(credit) : null,
    })
    .eq("id", id)
    .eq("restaurant_id", RESTAURANT_ID);
}

// The owner's own photo of this dish, from an earlier post: copied to the new post. True if found.
export async function reuseOwnerPhoto(supabase: SupabaseClient, id: number, dish: string): Promise<boolean> {
  const earlier = await supabase
    .from("marketing_posts")
    .select("id")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("photo_source", "owner")
    .ilike("dish_name", dish)
    .neq("id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  const from = earlier.error ? null : earlier.data?.[0]?.id;
  if (!from) return false;
  const copied = await supabase.storage.from("marketing").copy(ownPhotoPath(from), ownPhotoPath(id));
  if (copied.error) return false;
  await recordPhoto(supabase, id, "owner", null);
  return true;
}

const CROPS = ["attention", "centre", "entropy", "north"] as const;

// The photo for a new draft: the owner's own photo of the dish if they uploaded one before,
// otherwise a fresh stock photo (stored on the post with its credit).
export async function saveFreshPhoto(supabase: SupabaseClient, id: number, dish: string, salt: number): Promise<void> {
  if (await reuseOwnerPhoto(supabase, id, dish)) return;
  const found = await findDishPhoto(dish, salt).catch(() => null);
  let bytes = found?.bytes;
  let credit = found?.credit ?? null;
  if (!bytes) {
    await ensureDishPhoto(supabase, dish);
    bytes = await storedPhoto(supabase, dishPhotoPath(dish));
    credit = await storedCredit(supabase, dishPhotoPath(dish));
  }
  if (!bytes) return;
  const crop = CROPS[((salt % CROPS.length) + CROPS.length) % CROPS.length];
  const jpeg = await sharp(bytes).rotate().resize(1080, 1080, { fit: "cover", position: crop }).jpeg({ quality: 88 }).toBuffer();
  await supabase.storage.from("marketing").upload(ownPhotoPath(id), jpeg, { contentType: "image/jpeg", upsert: true });
  await recordPhoto(supabase, id, "stock", credit ?? { creator: null, license: "license unknown", source_url: null });
}

// The owner's upload if they added one, otherwise the dish photo.
export async function loadPostPhoto(supabase: SupabaseClient, id: number, dish: string): Promise<Buffer | undefined> {
  const own = await storedPhoto(supabase, ownPhotoPath(id));
  if (own) return own;
  const saved = await storedPhoto(supabase, dishPhotoPath(dish));
  if (saved) return saved;
  await ensureDishPhoto(supabase, dish).catch(() => null);
  return storedPhoto(supabase, dishPhotoPath(dish));
}
