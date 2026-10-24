// Turn a ThomasNet search into call leads. A lead must mention the food and have a phone.
// Equipment (a lime slicer, a packaging machine) does not count. Nothing here places a call.

const STOP = new Set(["with", "from", "that", "this", "rare", "fresh", "whole", "house"]);
const EQUIPMENT = /\b(machine|machinery|equipment|slicer|slicing|conveyor|packaging|parts|system|systems)\b/i;

export type LeadInsert = {
  source: "thomasnet";
  ingredient_name: string;
  company_name: string;
  phone: string;
  website: string | null;
  city: string | null;
  state: string | null;
  matched_product: string | null;
  tgrams_id: string | null;
  scraped_at: string;
};

// Words worth matching. "Limes" also matches "lime". Tiny words and filler are dropped.
export function foodWords(ingredient: string): string[] {
  const words = ingredient
    .toLowerCase()
    .replace(/[()]/g, " ")
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !STOP.has(word));
  const singular = words.filter((word) => word.endsWith("s") && word.length > 4).map((word) => word.slice(0, -1));
  return [...new Set([...words, ...singular])];
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function snippets(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    const text = textOf(value).replace(/\s+/g, " ").trim();
    if (text) out.push(text.slice(0, 240));
  };
  push(item.description);
  push(item.searchDescription);
  const heading = item.heading;
  if (heading && typeof heading === "object") {
    const record = heading as Record<string, unknown>;
    push(record.naturalName);
    push(record.name);
    push(record.description);
  }
  push(item.heading);
  if (Array.isArray(item.products)) {
    for (const product of item.products) {
      if (typeof product === "string") push(product);
      else if (product && typeof product === "object") {
        const record = product as Record<string, unknown>;
        push(record.name);
        push(record.description);
      }
    }
  }
  if (Array.isArray(item.headings)) {
    for (const heading of item.headings) {
      if (typeof heading === "string") push(heading);
      else if (heading && typeof heading === "object") push((heading as Record<string, unknown>).name);
    }
  }
  return out;
}

function mentionsFood(words: string[], text: string): boolean {
  const haystack = text.toLowerCase();
  return words.some((word) => haystack.includes(word));
}

// The first snippet that names the food and is not a machine. Null when nothing qualifies.
export function matchedFood(ingredient: string, item: Record<string, unknown>): string | null {
  const words = foodWords(ingredient);
  if (words.length === 0) return null;
  for (const snippet of snippets(item)) {
    if (mentionsFood(words, snippet) && !EQUIPMENT.test(snippet)) return snippet;
  }
  return null;
}

function phoneOf(item: Record<string, unknown>): string | null {
  const phone = textOf(item.primaryPhone).trim();
  return phone || null;
}

function addressOf(item: Record<string, unknown>): { city: string | null; state: string | null } {
  const address = item.address;
  if (!address || typeof address !== "object") return { city: null, state: null };
  const record = address as Record<string, unknown>;
  return {
    city: textOf(record.city).trim() || null,
    state: textOf(record.state).trim() || null,
  };
}

// Up to three companies with a phone and a real food mention. Same phone is kept once.
export function leadsFromItems(ingredient: string, items: unknown[], scrapedAt: string, limit = 3): LeadInsert[] {
  const leads: LeadInsert[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const phone = phoneOf(record);
    const company = textOf(record.name).trim();
    const matched = matchedFood(ingredient, record);
    if (!phone || !company || !matched) continue;
    const key = phone.replace(/\D/g, "") || phone;
    if (seen.has(key)) continue;
    seen.add(key);
    const address = addressOf(record);
    leads.push({
      source: "thomasnet",
      ingredient_name: ingredient,
      company_name: company,
      phone,
      website: textOf(record.website).trim() || null,
      city: address.city,
      state: address.state,
      matched_product: matched,
      tgrams_id: textOf(record.tgramsId).trim() || null,
      scraped_at: scrapedAt,
    });
    if (leads.length >= limit) break;
  }
  return leads;
}

// tel: link. Keeps a leading plus and the digits.
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  return `tel:${digits || trimmed}`;
}
