// Turn the pack sizes printed on supplier invoices into `pack_qty`: how many of the
// ingredient's own units one pack holds (the same meaning as supplier_prices.pack_qty).
//
//   "BF BRISKET 15#"     + ingredient unit lb    -> 15
//   "FISH SAUCE 6/25OZ"  + ingredient unit oz    -> 150
//   "HOISIN 5LB"         + ingredient unit oz    -> 80
//   "THAI BASIL 12BU"    + ingredient unit bunch -> 12
//   "LIME 200CT"         + ingredient unit ea    -> 200
//   "COCONUT MILK 24/13.5OZ" + ingredient unit can -> 24
//
// Unit cost (what the views use) is then unit_price / pack_qty.

export type Pack = {
  packs: number; // how many inner packs: "6/25OZ" -> 6
  size: number; // size of each inner pack: "6/25OZ" -> 25
  unit: string; // LB, OZ, GAL, CT, BU, EA, DZ, HEAD, CAN ...
};

// Weight in ounces, volume in fluid ounces, counts in "each".
const WEIGHT_OZ: Record<string, number> = { LB: 16, LBS: 16, "#": 16, OZ: 1, KG: 35.274, G: 0.035274 };
const VOLUME_FLOZ: Record<string, number> = { GAL: 128, QT: 32, PT: 16, FLOZ: 1, L: 33.814, ML: 0.033814 };
const COUNT: Record<string, number> = { CT: 1, EA: 1, PC: 1, PCS: 1, DZ: 12, DOZ: 12 };
const BUNCH = new Set(["BU", "BUN", "BUNCH", "BUNCHES", "BCH"]);
const HEAD = new Set(["HD", "HEAD", "HEADS"]);
const CAN = new Set(["CAN", "CANS", "CN"]);
const UNIT = "(LBS|LB|OZ|KG|G|GAL|QT|PT|FLOZ|ML|L|CT|EA|PCS|PC|DOZ|DZ|BUNCHES|BUNCH|BCH|BUN|BU|HEADS|HEAD|HD|CANS|CAN|CN|#)";

function clean(text: string | null | undefined) {
  return (text ?? "").toUpperCase().replace(/FL\.?\s*OZ/g, "FLOZ").replace(/\s+/g, " ");
}

// Finds the pack size in a description or pack column, or null if there isn't one.
export function parsePack(text: string | null | undefined): Pack | null {
  const t = clean(text);
  // "6/#10" = six #10 cans
  let m = t.match(/\b(\d+)\s*\/\s*#\s*10\b/);
  if (m) return { packs: Number(m[1]), size: 1, unit: "CAN10" };
  // Produce count sizes: "AVOCADO 48S" = a case of 48
  m = t.match(/\b(\d{2,3})S\b/);
  if (m) return { packs: 1, size: Number(m[1]), unit: "EA" };
  // "6/25OZ", "3/28 OZ", "4/5 LB", "24/13.5OZ"  (packs / size unit)
  m = t.match(new RegExp(`\\b(\\d+)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}(?![A-Z])`));
  if (m) return { packs: Number(m[1]), size: Number(m[2]), unit: m[3] === "#" ? "LB" : m[3] };
  // "15#", "10LB", "200CT", "12BU", "24 HEADS", "30 BUNCHES"
  m = t.match(new RegExp(`(?<![\\d/.])(\\d+(?:\\.\\d+)?)\\s*${UNIT}(?![A-Z])`));
  if (m) return { packs: 1, size: Number(m[1]), unit: m[2] === "#" ? "LB" : m[2] };
  return null;
}

// How many of `ingredientUnit` one pack holds, or null if the units don't convert
// (e.g. a pack in lb for an ingredient counted in heads).
export function packQtyIn(pack: Pack | null, ingredientUnit: string): number | null {
  if (!pack) return null;
  const want = ingredientUnit.trim().toLowerCase();
  const u = pack.unit;
  const total = pack.packs * pack.size;
  const round = (x: number) => Math.round(x * 100) / 100;

  if (want === "lb" || want === "oz") {
    const perOz = want === "lb" ? 1 / 16 : 1;
    if (u in WEIGHT_OZ) return round(total * WEIGHT_OZ[u] * perOz);
    if (u === "CAN10") return round(pack.packs * 105.6 * perOz); // a #10 can holds about 6.6 lb
    if (u in VOLUME_FLOZ && want === "oz") return round(total * VOLUME_FLOZ[u]); // sauces: fl oz ~ oz
    return null;
  }
  if (want === "gal" || want === "qt" || want === "floz") {
    const per = { gal: 1 / 128, qt: 1 / 32, floz: 1 }[want];
    return u in VOLUME_FLOZ ? round(total * VOLUME_FLOZ[u] * per) : null;
  }
  if (want === "bunch") return BUNCH.has(u) ? total : null;
  if (want === "head") return HEAD.has(u) || u in COUNT ? total * (COUNT[u] ?? 1) : null;
  if (want === "can") {
    if (CAN.has(u)) return total;
    if (u === "CAN10") return pack.packs;
    // "24/13.5OZ" for something counted in cans: the case holds 24 cans
    if (pack.packs > 1 && (u in WEIGHT_OZ || u in VOLUME_FLOZ)) return pack.packs;
    return null;
  }
  // ea, sheet, piece and any other count-like unit
  if (u in COUNT) return total * COUNT[u];
  if (CAN.has(u) || HEAD.has(u) || BUNCH.has(u)) return total;
  return null;
}

export function formatUnitCost(cost: number | null, unit: string) {
  if (cost == null || !Number.isFinite(cost)) return "?";
  return `$${cost < 1 ? cost.toFixed(3) : cost.toFixed(2)}/${unit}`;
}
