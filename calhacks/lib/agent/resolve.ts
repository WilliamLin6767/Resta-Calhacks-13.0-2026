// Turning what the owner says into exactly one record, in code (pure). "lime" finds Limes; "onion"
// with two onions asks which one; nothing is ever guessed. Also units ("2 cases") and counts
// that look wrong ("500 limes" when par is 40).
import { nameMatches } from "@/lib/purchasing/restock";

export type Resolved<T> = { ok: true; item: T } | { ok: false; ask: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");

const orList = (names: string[]) => (names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);

// One match by name: an exact name (ignoring case and plurals) wins, otherwise every word must
// match (nameMatches). Several or none: a question for the owner.
export function resolveOne<T>(items: T[], query: string, nameOf: (item: T) => string, what: string): Resolved<T> {
  const q = query.trim();
  if (!q) return { ok: false, ask: `Which ${what}?` };
  const exact = items.filter((item) => norm(nameOf(item)) === norm(q));
  if (exact.length === 1) return { ok: true, item: exact[0] };
  const hits = exact.length > 1 ? exact : items.filter((item) => nameMatches(nameOf(item), q));
  if (hits.length === 1) return { ok: true, item: hits[0] };
  if (hits.length > 1) {
    const names = [...new Set(hits.map(nameOf))].slice(0, 5);
    return { ok: false, ask: `Which one: ${orList(names)}${hits.length > 5 ? " (or another)" : ""}?` };
  }
  return { ok: false, ask: `I couldn't find ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what} called "${q}". Which ${what} did you mean?` };
}

// ---------- Invoices: "12", "#12", "BAM-20702", "the latest Sysco invoice" ----------

export type InvoiceRef = { id: number; invoice_number: string | null; invoice_date: string; supplier: string };

export function resolveInvoice<T extends InvoiceRef>(invoices: T[], query: string): Resolved<T> {
  const q = query.trim().toLowerCase();
  const label = (i: InvoiceRef) => `${i.supplier} ${i.invoice_number ?? `#${i.id}`} (${i.invoice_date})`;
  if (!q) return { ok: false, ask: "Which invoice?" };
  // An invoice number, or the app's own id ("invoice 12", "#12")
  const byNumber = invoices.filter((i) => i.invoice_number && i.invoice_number.toLowerCase() === q.replace(/^#/, ""));
  if (byNumber.length === 1) return { ok: true, item: byNumber[0] };
  const idMatch = q.match(/^(?:invoice\s*)?#?(\d+)$/);
  if (idMatch) {
    const byId = invoices.filter((i) => i.id === Number(idMatch[1]) || i.invoice_number?.toLowerCase().endsWith(idMatch[1]));
    if (byId.length === 1) return { ok: true, item: byId[0] };
    if (byId.length > 1) return { ok: false, ask: `Which one: ${orList(byId.slice(0, 4).map(label))}?` };
  }
  // By supplier: "the latest Sysco invoice" takes the newest; otherwise there must be only one
  const latest = /\b(latest|last|newest|most recent|recent)\b/.test(q);
  const supplierWords = q.replace(/\b(the|latest|last|newest|most|recent|invoice|invoices|bill|from|one)\b/g, " ").trim();
  if (supplierWords) {
    const fromSupplier = invoices.filter((i) => nameMatches(i.supplier, supplierWords));
    const sorted = [...fromSupplier].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || b.id - a.id);
    if (sorted.length === 1 || (latest && sorted.length > 1)) return { ok: true, item: sorted[0] };
    if (sorted.length > 1) return { ok: false, ask: `Which ${sorted[0].supplier} invoice: ${orList(sorted.slice(0, 4).map(label))}? Or say "the latest".` };
    if (!/\d/.test(supplierWords)) {
      const suppliers = [...new Set(invoices.map((i) => i.supplier))];
      return { ok: false, ask: `I don't see any invoice from "${supplierWords}". Invoices are from ${orList(suppliers.slice(0, 6))}. Which one did you mean?` };
    }
  } else if (latest && invoices.length) {
    return { ok: true, item: [...invoices].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || b.id - a.id)[0] };
  }
  return { ok: false, ask: `I couldn't find invoice "${query.trim()}". Which invoice did you mean?` };
}

// ---------- Units ----------

const UNIT_ALIASES: Record<string, string> = {
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", "#": "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gram: "g", grams: "g",
  ea: "ea", each: "ea", pc: "ea", pcs: "ea", piece: "ea", pieces: "ea", count: "ea", ct: "ea", unit: "ea", units: "ea",
  gal: "gal", gallon: "gal", gallons: "gal",
  qt: "qt", quart: "qt", quarts: "qt",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  bunch: "bunch", bunches: "bunch",
  dozen: "dozen", doz: "dozen",
};
const PACK_WORDS = new Set(["case", "cases", "cs", "pack", "packs", "pk", "box", "boxes", "bag", "bags", "crate", "crates", "flat", "flats", "carton", "cartons", "sack", "sacks", "tub", "tubs"]);
// To pounds, for weights
const TO_LB: Record<string, number> = { lb: 1, oz: 1 / 16, kg: 2.20462, g: 0.00220462 };

export const unitOf = (unit: string) => UNIT_ALIASES[unit.trim().toLowerCase()] ?? unit.trim().toLowerCase();

export type Qty = { ok: true; qty: number; note?: string } | { ok: false; ask: string };

// The amount in the ingredient's own unit. "2 cases" uses its pack size; an unknown pack size
// or a unit that doesn't convert is a question, never a guess.
export function toIngredientQty(
  amount: number,
  unit: string | undefined,
  ingredient: { name: string; unit: string; pack_qty: number | null; pack_desc?: string | null },
): Qty {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, ask: `How much ${ingredient.name}? I need a number.` };
  const own = unitOf(ingredient.unit);
  const said = unit?.trim() ? unit.trim().toLowerCase() : "";
  if (!said || unitOf(said) === own || (own === "ea" && unitOf(said) === "ea")) return { ok: true, qty: amount };
  if (PACK_WORDS.has(said)) {
    if (!ingredient.pack_qty || ingredient.pack_qty <= 0) {
      const one = said === "boxes" ? "box" : said.replace(/s$/, "");
      return { ok: false, ask: `How many ${ingredient.unit} are in a ${one} of ${ingredient.name}?` };
    }
    return { ok: true, qty: amount * ingredient.pack_qty, note: `${amount} ${said} x ${ingredient.pack_qty} ${ingredient.unit}${ingredient.pack_desc ? ` (${ingredient.pack_desc})` : ""}` };
  }
  const from = unitOf(said);
  if (from === "dozen" && own === "ea") return { ok: true, qty: amount * 12, note: `${amount} dozen = ${amount * 12}` };
  if (TO_LB[from] !== undefined && TO_LB[own] !== undefined) {
    const qty = Math.round(((amount * TO_LB[from]) / TO_LB[own]) * 100) / 100;
    return { ok: true, qty, note: `${amount} ${from} = ${qty} ${ingredient.unit}` };
  }
  return { ok: false, ask: `${ingredient.name} is counted in ${ingredient.unit}. How many ${ingredient.unit} is ${amount} ${said}?` };
}

// ---------- Counts that look wrong ----------

export const OUTLIER_PAR = 3; // more than 3x par...
export const OUTLIER_EXPECTED = 5; // ...or 5x what we expected on hand

// A "Did you mean ...?" question when a count is far above par or what we expected, or null.
// No par and nothing expected: nothing to compare with, so no question.
export function outlierQuestion(qty: number, line: { name: string; unit: string; par: number | null; expected: number }): string | null {
  const overPar = line.par !== null && line.par > 0 && qty > OUTLIER_PAR * line.par;
  const overExpected = line.expected > 0 && qty > OUTLIER_EXPECTED * line.expected;
  if (!overPar && !overExpected) return null;
  const why = overPar ? `par is ${line.par} ${line.unit}` : `we expected about ${line.expected} ${line.unit}`;
  return `Did you mean ${qty} ${line.unit} of ${line.name}? That's a lot (${why}). Say yes to save it.`;
}
