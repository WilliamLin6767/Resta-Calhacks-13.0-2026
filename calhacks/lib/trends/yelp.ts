// Yelp popular dishes via api-ninja/yelp-ultimate-scraper.
// Search listings first, then one popular-dish run for the top restaurants.
// Reviewer names are never read. Business name, rating, and the dish's review count are.

import { runActor } from "@/lib/market/apifyRun";
import { normalizeDishName } from "@/lib/trends/score";

export const YELP_ACTOR = "api-ninja~yelp-ultimate-scraper";
export const YELP_SEARCH_LIMIT = 40;
export const YELP_DISH_RESTAURANTS = 5;

export type YelpListing = {
  name: string;
  alias: string;
  rating: number;
  reviewCount: number;
  city: string;
  url: string;
};

export type YelpDish = {
  name: string;
  reviewCount: number;
  business: string;
  rating: number;
  url: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// "2115 Kittredge St, Berkeley, CA 94704" -> "Berkeley, CA". Fallback is the demo city.
export function searchLocation(address: string | null | undefined): string {
  if (!address) return "Berkeley, CA";
  const matches = [...address.matchAll(/([A-Za-z][A-Za-z .'-]*),\s*([A-Z]{2})\b/g)];
  const last = matches.at(-1);
  if (!last) return "Berkeley, CA";
  return `${last[1].trim()}, ${last[2]}`;
}

export function listingsFromItems(items: unknown[]): YelpListing[] {
  const listings: YelpListing[] = [];
  for (const item of items) {
    const row = record(item);
    if (!row || text(row.status) === "not_found") continue;
    const name = text(row.name);
    const alias = text(row.alias);
    if (!name || !alias) continue;
    listings.push({
      name,
      alias,
      rating: num(row.avg_rating ?? row.rating),
      reviewCount: num(row.review_count),
      city: text(row.city),
      url: `https://www.yelp.com/biz/${alias}`,
    });
  }
  return listings;
}

function isOwn(listing: YelpListing, ownName: string): boolean {
  const own = normalizeDishName(ownName);
  if (!own) return false;
  if (normalizeDishName(listing.name) === own) return true;
  const alias = listing.alias.toLowerCase().replace(/-/g, " ");
  return alias === own || alias.startsWith(`${own} `);
}

// Highest-rated nearby restaurants, excluding this restaurant. Berkeley listings win when any came back.
export function pickRestaurants(listings: YelpListing[], ownName: string, limit = YELP_DISH_RESTAURANTS): YelpListing[] {
  const others = listings.filter((listing) => !isOwn(listing, ownName));
  const berkeley = others.filter((listing) => listing.city.toLowerCase().includes("berkeley"));
  const pool = berkeley.length > 0 ? berkeley : others;
  return [...pool]
    .sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount)
    .slice(0, limit);
}

function listingFor(row: Record<string, unknown>, restaurants: YelpListing[]): YelpListing | null {
  const blobs = Object.values(row).flatMap((value) => (typeof value === "string" ? [value] : []));
  for (const restaurant of restaurants) {
    if (blobs.some((value) => value.includes(`/biz/${restaurant.alias}`) || value === restaurant.alias)) return restaurant;
  }
  const alias = text(row.alias);
  if (alias) return restaurants.find((restaurant) => restaurant.alias === alias) ?? null;
  return null;
}

function averageRating(restaurants: YelpListing[]): number {
  if (restaurants.length === 0) return 0;
  return restaurants.reduce((sum, restaurant) => sum + restaurant.rating, 0) / restaurants.length;
}

// Popular-dish rows are display_name + review_count. A row that names its restaurant keeps that rating.
// Rows the actor does not tag use the average rating of the restaurants in this run, so review count still ranks them.
export function dishesFromItems(items: unknown[], restaurants: YelpListing[]): YelpDish[] {
  const fallbackRating = averageRating(restaurants);
  const dishes: YelpDish[] = [];
  const seen = new Set<string>();

  function take(row: Record<string, unknown>, inherited: YelpListing | null) {
    if (text(row.status) === "not_found") return;
    const listing = listingFor(row, restaurants) ?? inherited;
    const name = text(row.display_name);
    if (name && listing) {
      const key = `${normalizeDishName(name)}|${listing.alias || listing.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        dishes.push({
          name,
          reviewCount: Math.max(0, num(row.review_count)),
          business: listing.name,
          rating: listing.rating,
          url: listing.url,
        });
      }
    } else if (name) {
      const key = `${normalizeDishName(name)}|yelp`;
      if (!seen.has(key)) {
        seen.add(key);
        dishes.push({
          name,
          reviewCount: Math.max(0, num(row.review_count)),
          business: "Yelp",
          rating: fallbackRating,
          url: "",
        });
      }
    }
    for (const value of Object.values(row)) {
      if (!Array.isArray(value)) continue;
      for (const child of value) {
        const nested = record(child);
        if (nested) take(nested, listing);
      }
    }
  }

  for (const item of items) {
    const row = record(item);
    if (row) take(row, null);
  }
  return dishes;
}

export async function searchYelp(token: string, location: string, query: string): Promise<YelpListing[]> {
  const items = await runActor(
    token,
    YELP_ACTOR,
    {
      location,
      query,
      categorySearch: false,
      details: "basic",
      includeAds: false,
      numberOfResults: YELP_SEARCH_LIMIT,
      scrapeAll: false,
    },
    YELP_SEARCH_LIMIT,
  );
  return listingsFromItems(items);
}

export async function popularDishes(token: string, restaurants: YelpListing[]): Promise<YelpDish[]> {
  const urls = restaurants.map((restaurant) => restaurant.url).slice(0, YELP_DISH_RESTAURANTS);
  if (urls.length === 0) return [];
  const items = await runActor(
    token,
    YELP_ACTOR,
    { businessUrlMenu: urls, dishType: "popular" },
    200,
  );
  return dishesFromItems(items, restaurants);
}
