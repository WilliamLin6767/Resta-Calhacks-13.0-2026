import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";
import { ownPhotoPath } from "@/lib/marketing/photoPath";

// Brave Image Search. Needs BRAVE_SEARCH_API_KEY from the Search plan at api-dashboard.search.brave.com.
export const BRAVE_IMAGE_SETUP = "Brave image search is not set up. Add BRAVE_SEARCH_API_KEY to .env.";
export const BRAVE_IMAGE_REJECTED = "Brave image search rejected the request. Check BRAVE_SEARCH_API_KEY.";

const RESULT_COUNT = 20;
const MAX_CANDIDATES = 6;

export type SearchHit = { url: string; title: string; width: number };

export type PhotoSearch = {
  dish: string;
  cuisine: string | null;
  usedUrls: string[];
  search: (query: string) => Promise<SearchHit[]>;
  download: (url: string) => Promise<Buffer | null>;
  writeQuery: (dish: string, cuisine: string | null) => Promise<string>;
  judge: (dish: string, photos: Buffer[]) => Promise<number>;
};

export function braveImageConfig(): { key: string } | { error: string } {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return { error: BRAVE_IMAGE_SETUP };
  return { key };
}

// Used when Claude cannot write a query. Keeps the words in the dish name, including the note in parentheses.
export function fallbackQuery(dish: string): string {
  const words = dish
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${words || "restaurant dish"} food photo`;
}

// Drops pictures this dish already used, duplicates, and images already known to be small.
export function unusedHits(hits: SearchHit[], usedUrls: string[]): SearchHit[] {
  const used = new Set(usedUrls);
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (!hit.url || used.has(hit.url) || seen.has(hit.url)) return false;
    if (hit.width > 0 && hit.width < 500) return false;
    seen.add(hit.url);
    return true;
  });
}

// Vision answers with a 1-based photo number. 0, or a number past the list, means none of them.
export function chosenPhoto<T>(index: number, photos: T[]): T | null {
  if (!Number.isInteger(index) || index < 1 || index > photos.length) return null;
  return photos[index - 1] ?? null;
}

const QuerySchema = z.object({ query: z.string() });
const PickSchema = z.object({ index: z.number().int() });

const QUERY_SYSTEM =
  "You write one image search query for a photograph of a restaurant dish. " +
  "Use plain English words a photographer would use. Name the dish and how it is served, such as bowl, plate, noodles, or soup. " +
  "No quotes, no site filters, no hashtags. At most 8 words.";

const PICK_SYSTEM =
  "You pick a photograph for a restaurant Instagram post. " +
  "Choose the one photo that is a real photograph of the named dish, with the food as the subject, close enough to crop square. " +
  "Reject logos, menus, collages, illustrations, screenshots, and photos of a different dish. " +
  "index is the photo number (1, 2, 3...). Use 0 if none qualify.";

async function writeQuery(dish: string, cuisine: string | null): Promise<string> {
  try {
    const parsed = await ask(QUERY_SYSTEM, `Dish: ${dish}\nCuisine: ${cuisine ?? "unknown"}`, QuerySchema, "low");
    const query = parsed.query.replace(/["']/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (query.length >= 3) return query;
  } catch {
    // The dish name is enough to search with.
  }
  return fallbackQuery(dish);
}

async function judge(dish: string, photos: Buffer[]): Promise<number> {
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  for (let i = 0; i < photos.length; i++) {
    const small = await sharp(photos[i]).rotate().resize(384, 384, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    content.push({ type: "text", text: `Photo ${i + 1}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } });
  }
  content.push({ type: "text", text: `Which photo shows ${dish}? Reply with its number, or 0 if none do.` });
  const parsed = await ask(PICK_SYSTEM, content, PickSchema, "low");
  return parsed.index;
}

type BraveImage = { title?: string; properties?: { url?: string; width?: number } };

// One result list. Brave image search has no page offset; properties.url is the file, not the web page.
async function searchBrave(query: string): Promise<SearchHit[]> {
  const config = braveImageConfig();
  if ("error" in config) throw new Error(config.error);
  const url = new URL("https://api.search.brave.com/res/v1/images/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(RESULT_COUNT));
  url.searchParams.set("safesearch", "strict");
  url.searchParams.set("country", "ALL");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": config.key },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return [];
  }
  if (response.status === 401 || response.status === 403) throw new Error(BRAVE_IMAGE_REJECTED);
  if (!response.ok) return [];
  const body = (await response.json()) as { results?: BraveImage[] };
  return (body.results ?? []).flatMap((item) => {
    const photo = item.properties?.url;
    if (!photo) return [];
    return [{ url: photo, title: item.title ?? "", width: item.properties?.width ?? 0 }];
  });
}

// Many photo hosts refuse a server fetch. Those come back empty and the next hit is tried.
async function downloadImage(url: string): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("text/") || type.includes("html") || type.includes("json") || type.includes("xml")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8_000) return null;
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
  } catch {
    return null;
  }
  return bytes;
}

// One search. If vision rejects the first photos, or their hosts block the download, keep walking the same list.
export async function chooseDishPhoto(input: PhotoSearch): Promise<{ bytes: Buffer; sourceUrl: string } | null> {
  let query = fallbackQuery(input.dish);
  try {
    const written = (await input.writeQuery(input.dish, input.cuisine)).trim();
    if (written) query = written;
  } catch {
    query = fallbackQuery(input.dish);
  }

  const hits = unusedHits(await input.search(query), input.usedUrls);
  for (let offset = 0; offset < hits.length; offset += MAX_CANDIDATES) {
    const downloaded: { bytes: Buffer; sourceUrl: string }[] = [];
    for (const hit of hits.slice(offset, offset + MAX_CANDIDATES)) {
      try {
        const bytes = await input.download(hit.url);
        if (bytes) downloaded.push({ bytes, sourceUrl: hit.url });
      } catch {
        continue;
      }
    }
    if (downloaded.length === 0) continue;
    let index = 0;
    try {
      index = await input.judge(
        input.dish,
        downloaded.map((item) => item.bytes),
      );
    } catch {
      index = 0;
    }
    const pick = chosenPhoto(index, downloaded);
    if (pick) return pick;
  }
  return null;
}

async function storedPhoto(supabase: SupabaseClient, path: string): Promise<Buffer | undefined> {
  const file = await supabase.storage.from("marketing").download(path);
  if (file.error || !file.data) return undefined;
  return Buffer.from(await file.data.arrayBuffer());
}

// A new picture for this draft, stored on the post. The source URL is remembered so the next draft skips it.
export async function saveFreshPhoto(supabase: SupabaseClient, id: number, dish: string, cuisine: string | null, usedUrls: string[]): Promise<void> {
  const found = await chooseDishPhoto({ dish, cuisine, usedUrls, search: searchBrave, download: downloadImage, writeQuery, judge });
  if (!found) return;
  const jpeg = await sharp(found.bytes).rotate().resize(1080, 1080, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
  const uploaded = await supabase.storage.from("marketing").upload(ownPhotoPath(id), jpeg, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) return;
  await supabase.from("marketing_used_photos").upsert({ source_url: found.sourceUrl, dish_name: dish, used_at: new Date().toISOString() }, { onConflict: "source_url" });
}

// The JPEG stored for this post. A missing file means the card stays a text frame.
export async function loadPostPhoto(supabase: SupabaseClient, id: number): Promise<Buffer | undefined> {
  return storedPhoto(supabase, ownPhotoPath(id));
}
