// Claude only groups dish names and lists ingredients. Scores are computed afterwards.

import { z } from "zod";
import { ask } from "@/lib/purchasing/ai";
import { splitIngredients, type SocialMention, type YelpMention } from "@/lib/trends/score";
import type { SocialPost } from "@/lib/trends/social";
import type { YelpDish } from "@/lib/trends/yelp";

const MapSchema = z.object({
  dishes: z.array(
    z.object({
      name: z.string(),
      yelp_indexes: z.array(z.number().int()),
      social_indexes: z.array(z.number().int()),
      ingredients: z.array(z.string()),
    }),
  ),
});

const MAP_SYSTEM =
  "You group public mentions of dishes for a Vietnamese restaurant that is deciding what to add. " +
  "The numbered Yelp dishes and social captions are the only sources. Do not invent a dish that is not in those lists. " +
  "The same dish under different names is one row (pho tai and rare beef pho). Omit a dish that is already on the menu. " +
  "ingredients: 4 to 8 foods the kitchen would need for one serving. When it is the same product as a stocked ingredient, copy that stocked name exactly. " +
  "Otherwise write a short plain name for something they would have to buy. " +
  "yelp_indexes and social_indexes are the numbers from the lists, starting at 1. Use an empty list when that side did not mention the dish.";

export type MappedDish = {
  name: string;
  have: string[];
  need: string[];
  yelp: YelpMention[];
  social: SocialMention[];
};

function at<T>(rows: T[], index: number): T | undefined {
  if (!Number.isInteger(index) || index < 1 || index > rows.length) return undefined;
  return rows[index - 1];
}

export async function mapDishes(input: {
  menuNames: string[];
  pantry: string[];
  yelp: YelpDish[];
  social: SocialPost[];
}): Promise<MappedDish[]> {
  const yelp = [...input.yelp].sort((a, b) => b.reviewCount * b.rating - a.reviewCount * a.rating).slice(0, 40);
  const social = [...input.social].filter((post) => post.caption).sort((a, b) => b.views + b.likes - (a.views + a.likes)).slice(0, 30);
  if (yelp.length === 0 && social.length === 0) return [];

  const yelpLines = yelp.map((dish, i) => `${i + 1}. ${dish.name} (${dish.reviewCount} reviews, ${dish.business})`).join("\n");
  const socialLines = social.map((post, i) => `${i + 1}. [${post.platform}] ${post.caption}`).join("\n");
  const prompt = [
    `Menu already served: ${input.menuNames.join(", ") || "(none)"}`,
    `Stocked ingredients: ${input.pantry.join(", ") || "(none)"}`,
    "",
    "Yelp popular dishes:",
    yelpLines || "(none)",
    "",
    "Social captions:",
    socialLines || "(none)",
  ].join("\n");

  const parsed = await ask(MAP_SYSTEM, prompt, MapSchema, "medium");
  const mapped: MappedDish[] = [];
  for (const dish of parsed.dishes) {
    const name = dish.name.trim();
    if (!name) continue;
    const yelpHits = dish.yelp_indexes.flatMap((index) => {
      const row = at(yelp, index);
      return row ? [{ business: row.business, rating: row.rating, reviewCount: row.reviewCount, url: row.url }] : [];
    });
    const socialHits = dish.social_indexes.flatMap((index) => {
      const row = at(social, index);
      return row ? [{ platform: row.platform, url: row.url, views: row.views, likes: row.likes }] : [];
    });
    if (yelpHits.length === 0 && socialHits.length === 0) continue;
    const ingredients = splitIngredients(dish.ingredients, input.pantry);
    mapped.push({ name, have: ingredients.have, need: ingredients.need, yelp: yelpHits, social: socialHits });
  }
  return mapped;
}
