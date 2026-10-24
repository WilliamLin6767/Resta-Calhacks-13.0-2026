// Demand times pantry fit. The model names ingredients; these functions decide the numbers.

export const NEW_INGREDIENT_CAP = 3;
export const DISPLAY_LIMIT = 8;

export type YelpMention = {
  business: string;
  rating: number;
  reviewCount: number;
  url: string;
};

export type SocialMention = {
  platform: "instagram" | "tiktok";
  url: string;
  views: number;
  likes: number;
};

export type DishInput = {
  name: string;
  have: string[];
  need: string[];
  yelp: YelpMention[];
  social: SocialMention[];
};

export type ScoredDish = {
  dish_name: string;
  demand_score: number;
  fit_score: number;
  recommend_score: number;
  new_ingredient_count: number;
  have_ingredients: string[];
  new_ingredients: string[];
  reason: string;
  evidence: { yelp: YelpMention[]; social: SocialMention[] };
};

// Lowercase, drop accents and the parenthetical, so "Pho Tai" matches "Pho Tai (rare beef)".
export function normalizeDishName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isOnMenu(dish: string, menuNames: string[]): boolean {
  const key = normalizeDishName(dish);
  if (!key) return false;
  return menuNames.some((name) => normalizeDishName(name) === key);
}

// A stocked name matches when it is the same text, or the suggestion contains that name
// and the stocked name is long enough that "rice" does not swallow "rice noodles".
export function splitIngredients(listed: string[], pantry: string[]): { have: string[]; need: string[] } {
  const have: string[] = [];
  const need: string[] = [];
  const seen = new Set<string>();
  for (const raw of listed) {
    const candidate = raw.trim();
    const key = normalizeDishName(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const matches = pantry.filter((name) => {
      const pantryKey = normalizeDishName(name);
      if (!pantryKey) return false;
      if (key === pantryKey) return true;
      return pantryKey.length >= 5 && key.includes(pantryKey);
    });
    matches.sort((a, b) => normalizeDishName(b).length - normalizeDishName(a).length);
    const match = matches[0];
    if (match) {
      if (!have.some((name) => normalizeDishName(name) === normalizeDishName(match))) have.push(match);
    } else {
      need.push(candidate);
    }
  }
  return { have, need };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function yelpSignal(hits: YelpMention[]): number {
  return hits.reduce((sum, hit) => sum + Math.max(0, hit.reviewCount) * (Math.min(5, Math.max(0, hit.rating)) / 5), 0);
}

function socialSignal(hits: SocialMention[]): number {
  return hits.reduce((sum, hit) => {
    const views = Math.max(0, hit.views);
    const likes = Math.max(0, hit.likes);
    return sum + Math.log10(1 + views) + 0.25 * Math.log10(1 + likes);
  }, 0);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

export function recommendationReason(dish: Pick<DishInput, "yelp" | "social" | "have" | "need">): string {
  const reviews = dish.yelp.reduce((sum, hit) => sum + Math.max(0, hit.reviewCount), 0);
  const places = dish.yelp.length;
  const posts = dish.social.length;
  const yelpBit = `${places} Yelp ${places === 1 ? "menu" : "menus"} (${reviews} reviews)`;
  const postBit = `${posts} ${posts === 1 ? "post" : "posts"}`;
  const mention =
    places > 0 && posts > 0
      ? `Mentioned on ${yelpBit} and ${postBit}.`
      : places > 0
        ? `Mentioned on ${yelpBit}.`
        : posts > 0
          ? `Mentioned in ${postBit}.`
          : "No outside mentions.";
  const stock = dish.have.length > 0 ? `You already stock ${joinList(dish.have)}.` : "You already stock none of these ingredients.";
  const buy = dish.need.length > 0 ? `You would buy ${joinList(dish.need)}.` : "You would not need to buy anything new.";
  return `${mention} ${stock} ${buy}`;
}

export function compareRecommendations<T extends { new_ingredient_count: number; recommend_score: number }>(a: T, b: T): number {
  const aReady = a.new_ingredient_count <= NEW_INGREDIENT_CAP ? 0 : 1;
  const bReady = b.new_ingredient_count <= NEW_INGREDIENT_CAP ? 0 : 1;
  if (aReady !== bReady) return aReady - bReady;
  return b.recommend_score - a.recommend_score;
}

// Drops dishes already on the menu. Demand is yelp and social each scaled to the batch max.
// A dish seen on only one side uses that side at full weight. Fit is the share of ingredients already in stock.
export function scoreDishes(dishes: DishInput[], menuNames: string[], limit = DISPLAY_LIMIT): ScoredDish[] {
  const fresh = dishes.filter((dish) => dish.name.trim() && !isOnMenu(dish.name, menuNames));
  const yelpRaw = fresh.map((dish) => yelpSignal(dish.yelp));
  const socialRaw = fresh.map((dish) => socialSignal(dish.social));
  const yelpMax = Math.max(0, ...yelpRaw);
  const socialMax = Math.max(0, ...socialRaw);

  const scored = fresh.map((dish, index) => {
    const yelpNorm = yelpMax === 0 ? 0 : yelpRaw[index] / yelpMax;
    const socialNorm = socialMax === 0 ? 0 : socialRaw[index] / socialMax;
    const hasYelp = yelpRaw[index] > 0;
    const hasSocial = socialRaw[index] > 0;
    const demand = hasYelp && hasSocial ? 0.6 * yelpNorm + 0.4 * socialNorm : hasYelp ? yelpNorm : hasSocial ? socialNorm : 0;
    const total = dish.have.length + dish.need.length;
    const fit = total === 0 ? 0 : dish.have.length / total;
    return {
      dish_name: dish.name.trim(),
      demand_score: round3(demand),
      fit_score: round3(fit),
      recommend_score: round3(demand * fit),
      new_ingredient_count: dish.need.length,
      have_ingredients: dish.have,
      new_ingredients: dish.need,
      reason: recommendationReason(dish),
      evidence: {
        yelp: dish.yelp.map((hit) => ({
          business: hit.business,
          rating: hit.rating,
          reviewCount: hit.reviewCount,
          url: hit.url,
        })),
        social: dish.social.map((hit) => ({
          platform: hit.platform,
          url: hit.url,
          views: hit.views,
          likes: hit.likes,
        })),
      },
    };
  });

  return scored.sort(compareRecommendations).slice(0, limit);
}
