// Match messy invoice text to the restaurant's ingredients.
//
// "BF BRISKET 15#" and "Beef Brisket 15 lb case" should both land on "Brisket".
// Three steps, cheapest first:
//   1. learned - this exact text from this supplier was confirmed before (ingredient_aliases)
//   2. fuzzy   - expand supplier shorthand, then compare word by word
//   3. ai      - Claude picks from the closest candidates (only for lines 1-2 can't settle)
// Anything below CONFIDENT gets needs_review, and the person's answer becomes a learned match.

export const CONFIDENT = 0.85;

// Supplier shorthand -> plain words (butcher, produce and Asian grocery invoices)
const ABBREVIATIONS: Record<string, string> = {
  BF: "BEEF", BEEF: "BEEF", PRK: "PORK", CHKN: "CHICKEN", CHK: "CHICKEN", CHIX: "CHICKEN", FRYER: "CHICKEN",
  FRYERS: "CHICKEN", BRST: "BREAST", THGH: "THIGH", BNLS: "BONELESS", SKLS: "SKINLESS", GRD: "GROUND", GRND: "GROUND",
  BUTT: "SHOULDER", SHLDR: "SHOULDER", RND: "ROUND", HC: "HONEYCOMB", TDN: "TENDON", BRSKT: "BRISKET",
  SHRMP: "SHRIMP", ONN: "ONION", YLW: "YELLOW", YEL: "YELLOW", GRN: "GREEN", RD: "RED", WHT: "WHITE",
  CIL: "CILANTRO", BSL: "BASIL", SPRT: "SPROUT", SPROUTS: "SPROUT", LMNGRS: "LEMONGRASS", GNGR: "GINGER",
  LTTC: "LETTUCE", LTC: "LETTUCE", LEAF: "LEAF", VERM: "VERMICELLI", NDL: "NOODLE", NDLS: "NOODLE",
  NOODLES: "NOODLE", RCE: "RICE", PPR: "PAPER", WRP: "WRAPPER", WRPR: "WRAPPER", SCE: "SAUCE", SAU: "SAUCE",
  CNDNSD: "CONDENSED", SWTND: "SWEETENED", CCNT: "COCONUT", MLK: "MILK", BGT: "BAGUETTE", BAGUETTES: "BAGUETTE",
  PCKLD: "PICKLED", CRRT: "CARROT", DKN: "DAIKON", MB: "MEATBALL", MTBL: "MEATBALL", MEATBALLS: "MEATBALL",
  LG: "LARGE", LRG: "LARGE", MED: "MEDIUM", SM: "SMALL", FRZ: "FROZEN", FZN: "FROZEN", FRSH: "FRESH",
};
// Words that describe packaging, grade or freshness, not what the item is
const NOISE = new Set([
  "CS", "CASE", "BX", "BOX", "BG", "BAG", "SACK", "PK", "PACK", "JIB", "JUG", "JAR", "TUB", "CTN", "EA", "LB",
  "LBS", "OZ", "CT", "GAL", "DZ", "BU", "BUNCH", "BUNCHES", "HEAD", "HEADS", "IN", "USDA", "CHOICE", "SELECT",
  "PRIME", "GRADE", "FCY", "FANCY", "IQF", "BULK", "NAT", "NATURAL", "PREMIUM", "PREM", "HOUSE", "BRAND",
  "PACKER", "FRESH", "KNUCKLE", "WHOLE",
]);
const PLURAL_KEEP = new Set(["BEANS", "GRASS", "LEMONGRASS", "CHIPS", "MOLASSES"]);

export function normalize(text: string): string {
  let t = (text ?? "").toUpperCase();
  t = t.replace(/\d+\s*\/\s*#\s*10/g, " "); // 6/#10
  t = t.replace(/\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s*[A-Z#]*/g, " "); // 6/25OZ, 21/25
  t = t.replace(/\d+(\.\d+)?\s*#/g, " "); // 40#
  t = t.replace(/[^A-Z0-9 ]/g, " ");
  const words: string[] = [];
  for (let w of t.split(/\s+/)) {
    if (!w || /\d/.test(w)) continue; // item codes and sizes: 200CT, 12BU, 10LB
    w = ABBREVIATIONS[w] ?? w;
    if (NOISE.has(w) || w.length === 1) continue;
    if (w.endsWith("ES") && ["TOMATO", "POTATO"].includes(w.slice(0, -2))) w = w.slice(0, -2);
    else if (w.endsWith("S") && !w.endsWith("SS") && w.length > 3 && !PLURAL_KEEP.has(w)) w = w.slice(0, -1);
    words.push(w);
  }
  return words.join(" ");
}

// ---------- Fuzzy scoring (same idea as Python's rapidfuzz.token_set_ratio) ----------

// Similarity of two strings, 0-1, from their longest common subsequence.
function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}

// Compares the words two strings share, ignoring order and extra words on one side.
// "CHICKEN THIGH" vs "CHICKEN THIGH BONELESS" scores 1.
export function tokenSetRatio(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  const both = [...A].filter((w) => B.has(w)).sort();
  const onlyA = [...A].filter((w) => !B.has(w)).sort();
  const onlyB = [...B].filter((w) => !A.has(w)).sort();
  if (both.length && (!onlyA.length || !onlyB.length)) return 1;
  const s = both.join(" ");
  const sa = [s, ...onlyA].filter(Boolean).join(" ");
  const sb = [s, ...onlyB].filter(Boolean).join(" ");
  return Math.max(ratio(s, sa), ratio(s, sb), ratio(sa, sb));
}

// ---------- Matching ----------

export type Ingredient = { id: number; name: string; unit: string };
export type Alias = { alias: string; ingredient_id: number; supplier_id: number | null };
export type Candidate = { ingredient_id: number; score: number };
export type Match = {
  ingredient_id: number | null;
  score: number;
  source: "learned" | "fuzzy" | null;
  norm: string;
  candidates: Candidate[];
};

export function candidates(text: string, ingredients: Ingredient[], aliases: Alias[], limit = 8): Candidate[] {
  const norm = normalize(text);
  const best = new Map<number, number>();
  const consider = (choice: string, id: number) => {
    const s = tokenSetRatio(norm, choice);
    if (s > (best.get(id) ?? -1)) best.set(id, s);
  };
  for (const ing of ingredients) consider(normalize(ing.name), ing.id);
  for (const a of aliases) consider(a.alias, a.ingredient_id);
  return [...best.entries()]
    .map(([ingredient_id, score]) => ({ ingredient_id, score }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

export function matchLine(text: string, supplierId: number | null, ingredients: Ingredient[], aliases: Alias[]): Match {
  const norm = normalize(text);
  const learned = aliases.find((a) => a.alias === norm && (a.supplier_id === supplierId || a.supplier_id === null));
  if (learned) return { ingredient_id: learned.ingredient_id, score: 1, source: "learned", norm, candidates: [] };

  const cands = candidates(text, ingredients, aliases);
  if (cands.length) {
    const top = cands[0];
    const lead = top.score - (cands[1]?.score ?? 0);
    // A strong match clearly ahead of the next best, or a decent one far ahead of everything else
    if ((top.score >= 0.9 && lead >= 0.08) || (top.score >= 0.75 && lead >= 0.3)) {
      return { ingredient_id: top.ingredient_id, score: Math.max(top.score, CONFIDENT), source: "fuzzy", norm, candidates: cands };
    }
  }
  return { ingredient_id: null, score: cands[0]?.score ?? 0, source: null, norm, candidates: cands };
}
