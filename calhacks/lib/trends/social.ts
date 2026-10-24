// Public captions and engagement only. Usernames, comments, and profile fields are dropped.

import { runActor } from "@/lib/market/apifyRun";

export const INSTAGRAM_ACTOR = "apify~instagram-search-scraper";
export const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

export type SocialPost = {
  platform: "instagram" | "tiktok";
  url: string;
  views: number;
  likes: number;
  caption: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(caption: string): string {
  return caption.replace(/\s+/g, " ").slice(0, 280);
}

function httpUrl(value: string): string {
  return value.startsWith("https://") || value.startsWith("http://") ? value : "";
}

// "Vietnamese" -> instagram "Vietnamese food berkeley, pho" and two TikTok searches.
export function socialQueries(cuisine: string | null | undefined): { instagram: string; tiktok: string[] } {
  const food = (cuisine ?? "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() || "Vietnamese";
  return {
    instagram: `${food} food berkeley, pho`,
    tiktok: [`${food} food berkeley`, "pho"],
  };
}

export function instagramPosts(items: unknown[]): SocialPost[] {
  const posts: SocialPost[] = [];
  for (const item of items) {
    const row = record(item);
    if (!row || text(row.error)) continue;
    const caption = clip(text(row.caption));
    const url = httpUrl(text(row.url));
    if (!caption && !url) continue;
    posts.push({
      platform: "instagram",
      url,
      views: num(row.videoViewCount ?? row.videoPlayCount),
      likes: num(row.likesCount),
      caption,
    });
  }
  return posts.slice(0, 16);
}

export function tiktokPosts(items: unknown[]): SocialPost[] {
  const posts: SocialPost[] = [];
  for (const item of items) {
    const row = record(item);
    if (!row) continue;
    const caption = clip(text(row.text));
    const url = httpUrl(text(row.webVideoUrl));
    if (!caption && !url) continue;
    posts.push({
      platform: "tiktok",
      url,
      views: num(row.playCount),
      likes: num(row.diggCount),
      caption,
    });
  }
  return posts.slice(0, 30);
}

export async function searchInstagram(token: string, search: string): Promise<SocialPost[]> {
  const items = await runActor(
    token,
    INSTAGRAM_ACTOR,
    {
      search,
      searchType: "popular",
      searchLimit: 8,
      enhanceUserSearchWithFacebookPage: false,
    },
    40,
  );
  return instagramPosts(items);
}

export async function searchTikTok(token: string, queries: string[]): Promise<SocialPost[]> {
  const items = await runActor(
    token,
    TIKTOK_ACTOR,
    {
      searchQueries: queries,
      resultsPerPage: 15,
      searchSection: "/video",
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSlideshowImages: false,
      shouldDownloadAvatars: false,
      shouldDownloadMusicCovers: false,
      shouldDownloadSubtitles: false,
      downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES",
      scrapeRelatedVideos: false,
      commentsPerPost: 0,
      proxyCountryCode: "None",
    },
    40,
  );
  return tiktokPosts(items);
}
