export type PostEdit = {
  dishName: string;
  headline: string;
  subhead: string;
  caption: string;
  hashtags: string[];
};

// Hashtags typed in the editor: split on spaces and commas, keep up to 20.
export function parseHashtags(value: string): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const word = part.replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "");
    if (word.length < 2 || word.length > 30) continue;
    const hash = `#${word}`;
    const key = hash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(hash);
    if (cleaned.length === 20) break;
  }
  return cleaned;
}

export function readPostEdit(body: {
  dishName?: unknown;
  headline?: unknown;
  subhead?: unknown;
  caption?: unknown;
  hashtags?: unknown;
}): PostEdit | { error: string } {
  const dishName = typeof body.dishName === "string" ? body.dishName.trim() : "";
  const headline = typeof body.headline === "string" ? body.headline.trim() : "";
  const subhead = typeof body.subhead === "string" ? body.subhead.trim() : "";
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const rawTags = typeof body.hashtags === "string" ? body.hashtags : "";
  if (!dishName) return { error: "The dish name can't be empty." };
  if (!headline) return { error: "The headline can't be empty." };
  if (!caption) return { error: "Write a caption before saving." };
  if (dishName.length > 80 || headline.length > 120 || subhead.length > 240) {
    return { error: "Shorten the dish name, headline, or the line under it." };
  }
  if (caption.length > 2200) return { error: "Instagram captions stop at 2,200 characters." };
  return { dishName, headline, subhead, caption, hashtags: parseHashtags(rawTags) };
}
