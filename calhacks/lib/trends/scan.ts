// One trends scan: Yelp search, then popular dishes, in parallel with Instagram and TikTok.

import { mapDishes, type MappedDish } from "@/lib/trends/map";
import { normalizeDishName, scoreDishes, type ScoredDish } from "@/lib/trends/score";
import { searchInstagram, searchTikTok, socialQueries, type SocialPost } from "@/lib/trends/social";
import { popularDishes, searchLocation, searchYelp, pickRestaurants, type YelpDish } from "@/lib/trends/yelp";

export type TrendScan = {
  recommendations: ScoredDish[];
  failures: string[];
};

function sameName(a: string, b: string): boolean {
  return normalizeDishName(a) === normalizeDishName(b);
}

// The model sometimes splits one dish across two rows. Fold those together before scoring.
function mergeDishes(dishes: MappedDish[]): MappedDish[] {
  const merged: MappedDish[] = [];
  for (const dish of dishes) {
    const prev = merged.find((row) => sameName(row.name, dish.name));
    if (!prev) {
      merged.push({ ...dish, have: [...dish.have], need: [...dish.need], yelp: [...dish.yelp], social: [...dish.social] });
      continue;
    }
    for (const name of dish.have) {
      if (!prev.have.some((have) => sameName(have, name))) prev.have.push(name);
    }
    for (const name of dish.need) {
      if (prev.have.some((have) => sameName(have, name)) || prev.need.some((need) => sameName(need, name))) continue;
      prev.need.push(name);
    }
    prev.yelp.push(...dish.yelp);
    prev.social.push(...dish.social);
  }
  return merged;
}

async function settle<T>(source: string, run: Promise<T>, failures: string[]): Promise<T | null> {
  try {
    return await run;
  } catch (err) {
    failures.push(`${source}: ${err instanceof Error ? err.message : "search failed"}`);
    return null;
  }
}

export async function scanMenuTrends(
  token: string,
  input: { ownName: string; cuisine: string | null; address: string | null; menuNames: string[]; pantry: string[] },
): Promise<TrendScan> {
  const failures: string[] = [];
  const queries = socialQueries(input.cuisine);
  const location = searchLocation(input.address);
  const query = input.cuisine?.trim() || "Vietnamese";

  const [listings, instagram, tiktok] = await Promise.all([
    settle("Yelp", searchYelp(token, location, query), failures),
    settle("Instagram", searchInstagram(token, queries.instagram), failures),
    settle("TikTok", searchTikTok(token, queries.tiktok), failures),
  ]);

  let yelpDishes: YelpDish[] = [];
  if (listings) {
    const picked = pickRestaurants(listings, input.ownName);
    if (picked.length === 0) failures.push("Yelp: no other restaurant matched that search.");
    else yelpDishes = (await settle("Yelp dishes", popularDishes(token, picked), failures)) ?? [];
  }

  const posts: SocialPost[] = [...(instagram ?? []), ...(tiktok ?? [])];
  if (yelpDishes.length === 0 && posts.length === 0) {
    throw new Error(failures[0] ?? "Yelp and social searches returned no dishes.");
  }

  const mapped = await mapDishes({ menuNames: input.menuNames, pantry: input.pantry, yelp: yelpDishes, social: posts });
  return { recommendations: scoreDishes(mergeDishes(mapped), input.menuNames), failures };
}
