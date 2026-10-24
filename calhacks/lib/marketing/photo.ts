import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dishPhotoPath, dishPhotoUrl, ownPhotoPath } from "@/lib/marketing/photoPath";

type Hit = { title?: string; url?: string; width?: number };

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

async function firstPhoto(query: string, dish: string, requireMatch: boolean): Promise<Buffer | null> {
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
      if (bytes) return bytes;
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

// A food photo for the dish. `salt` starts at a different search result so a new draft is not the same picture.
export async function findDishPhoto(dish: string, salt = 0): Promise<Buffer | null> {
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
      if (bytes) return bytes;
    } catch {
      continue;
    }
  }
  return firstPhoto("vietnamese food bowl", dish, false);
}

// Saves the dish photo in the public marketing bucket and returns its URL. Reuses a photo already saved for that dish.
export async function ensureDishPhoto(supabase: SupabaseClient, dish: string): Promise<string | null> {
  const path = dishPhotoPath(dish);
  const existing = await supabase.storage.from("marketing").download(path);
  if (!existing.error && existing.data) return dishPhotoUrl(dish);

  const source = await findDishPhoto(dish);
  if (!source) return null;
  const jpeg = await sharp(source).rotate().resize(1080, 1080, { fit: "cover", position: "centre" }).jpeg({ quality: 86 }).toBuffer();
  const uploaded = await supabase.storage.from("marketing").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) return null;
  return dishPhotoUrl(dish);
}

async function storedPhoto(supabase: SupabaseClient, path: string): Promise<Buffer | undefined> {
  const file = await supabase.storage.from("marketing").download(path);
  if (file.error || !file.data) return undefined;
  return Buffer.from(await file.data.arrayBuffer());
}

const CROPS = ["attention", "centre", "entropy", "north"] as const;

// A new picture for this draft, stored on the post so the next draft can choose a different one.
export async function saveFreshPhoto(supabase: SupabaseClient, id: number, dish: string, salt: number): Promise<void> {
  const source = await findDishPhoto(dish, salt).catch(() => null);
  const bytes = source ?? (await ensureDishPhoto(supabase, dish).then(() => storedPhoto(supabase, dishPhotoPath(dish))));
  if (!bytes) return;
  const crop = CROPS[((salt % CROPS.length) + CROPS.length) % CROPS.length];
  const jpeg = await sharp(bytes).rotate().resize(1080, 1080, { fit: "cover", position: crop }).jpeg({ quality: 88 }).toBuffer();
  await supabase.storage.from("marketing").upload(ownPhotoPath(id), jpeg, { contentType: "image/jpeg", upsert: true });
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
