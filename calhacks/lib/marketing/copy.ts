// Turns Claude's draft into posts that only name dishes the restaurant actually has.

export const LAYOUTS = ["plate", "special", "night", "boost", "boost-poster", "poll", "poll-poster"] as const;
export type PostLayout = (typeof LAYOUTS)[number];

export type DraftPost = {
  layout: PostLayout;
  dish_name: string;
  headline: string;
  subhead: string;
  caption: string;
  hashtags: string[];
};

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// Prefer the dish Claude named when it is one we allowed. Otherwise take the next unused dish.
export function pickDish(name: string, allowed: string[]): string {
  if (allowed.length === 0) return name.trim();
  const target = norm(name);
  const exact = allowed.find((dish) => norm(dish) === target);
  if (exact) return exact;
  const partial = allowed.find((dish) => {
    const folded = norm(dish);
    return target.length > 3 && (folded.includes(target) || target.includes(folded));
  });
  return partial ?? allowed[0];
}

export function assignDishes(names: string[], allowed: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const unused = allowed.filter((dish) => !used.has(dish));
    const dish = pickDish(name, unused.length > 0 ? unused : allowed);
    used.add(dish);
    return dish;
  });
}

export function cleanHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const tag of tags) {
    const word = tag.replace(/[^A-Za-z0-9]/g, "");
    if (word.length < 2 || word.length > 30) continue;
    const hash = `#${word}`;
    const key = hash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(hash);
    if (cleaned.length === 6) break;
  }
  return cleaned;
}

const POLL_ASK = "Comment ADD to put it on the menu, or SKIP to leave it off.";

// Caption plus any hashtags the caption does not already contain. Instagram stops at 2,200 characters.
export function captionFor(caption: string, hashtags: string[]): string {
  const body = caption.trim();
  const missing = hashtags.filter((tag) => !body.toLowerCase().includes(tag.toLowerCase()));
  return [body, missing.join(" ")].filter(Boolean).join("\n\n").slice(0, 2200);
}

export function withPollAsk(caption: string): string {
  if (caption.toLowerCase().includes("comment add")) return caption.trim();
  return `${caption.trim()}\n\n${POLL_ASK}`.trim();
}

export function isPoll(layout: string): boolean {
  return layout.startsWith("poll");
}

export function isPoster(layout: string): boolean {
  return layout.endsWith("poster");
}

export function finishCopy(post: DraftPost): DraftPost {
  const body = clip(post.caption, isPoll(post.layout) ? 400 : 500);
  return {
    ...post,
    headline: clip(post.headline, 42),
    subhead: clip(post.subhead, 90),
    caption: isPoll(post.layout) ? withPollAsk(body) : body,
    hashtags: cleanHashtags(post.hashtags),
  };
}

export function shapeDrafts(posts: DraftPost[], allowed: string[]): DraftPost[] {
  const dishes = assignDishes(
    posts.map((post) => post.dish_name),
    allowed,
  );
  return posts.slice(0, 3).map((post, index) => ({
    layout: LAYOUTS.includes(post.layout) ? post.layout : LAYOUTS[index % LAYOUTS.length],
    dish_name: dishes[index] || post.dish_name.trim(),
    headline: clip(post.headline, 42),
    subhead: clip(post.subhead, 90),
    caption: clip(post.caption, 500),
    hashtags: cleanHashtags(post.hashtags),
  }));
}
