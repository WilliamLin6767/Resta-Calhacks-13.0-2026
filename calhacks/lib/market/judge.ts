// Compare a supplier's price jump with a USDA AMS livestock or dairy series.
// Pure functions only. USDA prices are a public index, not a place to buy.

import { percentChange } from "@/lib/insights";

export type IngredientFamily = "beef" | "dairy";

export type QuotePoint = {
  reportId: number;
  commodity: string;
  className: string;
  priceUnit: string;
  marketLocation: string | null;
  reportDate: string; // YYYY-MM-DD
  priceAvg: number;
  family: IngredientFamily;
};

export type VerdictKind = "market_wide" | "this_supplier" | "no_comparison";

export type Verdict = {
  kind: VerdictKind;
  label: string;
  detail: string;
};

// Both moves are already percents (13.9 means +13.9%). Within this many points counts as the same move.
const CLOSE_POINTS = 5;
const SUPPLIER_UP = 5;

const INGREDIENT_DAIRY = /\b(milk|cream|butter|cheese|yogurt|dairy)\b/i;
const INGREDIENT_BEEF = /\b(beef|brisket|tendon|tripe|oxtail|chuck|ribeye|short\s*ribs?|flank|sirloin|shank|steak)\b/i;

const ROW_DAIRY = /\b(milk|cream|butter|cheese|dairy|whey)\b/i;
const ROW_BEEF = /\b(cattle|beef|steers?|heifers?|cows?|bulls?|calves?)\b/i;

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

export function ingredientFamily(name: string): IngredientFamily | null {
  if (INGREDIENT_DAIRY.test(name)) return "dairy";
  if (INGREDIENT_BEEF.test(name)) return "beef";
  return null;
}

// Which public series a USDA row belongs to. Produce and other livestock are dropped.
export function quoteFamily(row: {
  category?: string | null;
  commodity?: string | null;
  class?: string | null;
}): IngredientFamily | null {
  const category = (row.category ?? "").toLowerCase();
  const text = `${row.commodity ?? ""} ${row.class ?? ""}`;
  if (category === "dairy" || ROW_DAIRY.test(text)) return "dairy";
  const livestock = category === "livestock_auction" || category === "livestock" || category === "";
  if (livestock && ROW_BEEF.test(text)) return "beef";
  return null;
}

// "07/28/2026" or "2026-07-28" → "2026-07-28". Anything else is unusable.
export function parseReportDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export type MarketMove = {
  changePct: number;
  fromDate: string;
  toDate: string;
  location: string | null;
  commodity: string;
  className: string;
  priceUnit: string;
};

// One series is the same report, commodity, class, and unit. The earlier price is the
// latest quote on or before `since`. The later price is the latest quote after `since`.
export function marketMove(points: QuotePoint[], family: IngredientFamily, since: string): MarketMove | null {
  const groups = new Map<string, QuotePoint[]>();
  for (const point of points) {
    if (point.family !== family || !point.reportDate || !Number.isFinite(point.priceAvg)) continue;
    const key = [point.reportId, point.commodity, point.className, point.priceUnit].join("|");
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }

  let best: (MarketMove & { count: number }) | null = null;
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
    const before = sorted.filter((p) => p.reportDate <= since);
    const after = sorted.filter((p) => p.reportDate > since);
    if (before.length === 0 || after.length === 0) continue;
    const from = before[before.length - 1];
    const to = after[after.length - 1];
    const changePct = percentChange(to.priceAvg, from.priceAvg);
    if (changePct == null) continue;
    const move: MarketMove & { count: number } = {
      changePct,
      fromDate: from.reportDate,
      toDate: to.reportDate,
      location: to.marketLocation,
      commodity: to.commodity,
      className: to.className,
      priceUnit: to.priceUnit,
      count: sorted.length,
    };
    const fresher = !best || move.toDate > best.toDate || (move.toDate === best.toDate && move.count > best.count);
    if (fresher) best = move;
  }
  if (!best) return null;
  const { count: _count, ...move } = best;
  return move;
}

export type ChartSeries = {
  label: string;
  rows: { date: string; price: number }[];
};

// The freshest beef or dairy series with at least two dates, for the Suppliers chart.
export function chartSeries(points: QuotePoint[], family: IngredientFamily): ChartSeries | null {
  const groups = new Map<string, QuotePoint[]>();
  for (const point of points) {
    if (point.family !== family || !point.reportDate || !Number.isFinite(point.priceAvg)) continue;
    const key = [point.reportId, point.commodity, point.className, point.priceUnit].join("|");
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }

  let best: { points: QuotePoint[]; latest: string } | null = null;
  for (const list of groups.values()) {
    const byDate = new Map<string, QuotePoint>();
    for (const point of list) byDate.set(point.reportDate, point);
    const unique = [...byDate.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
    if (unique.length < 2) continue;
    const latest = unique[unique.length - 1].reportDate;
    const fresher = !best || latest > best.latest || (latest === best.latest && unique.length > best.points.length);
    if (fresher) best = { points: unique, latest };
  }
  if (!best) return null;
  const sample = best.points[best.points.length - 1];
  const what = [sample.commodity, sample.className].filter(Boolean).join(", ");
  const where = sample.marketLocation ? ` at ${sample.marketLocation}` : "";
  return {
    label: `${what}${where} (${sample.priceUnit})`,
    rows: best.points.map((point) => ({ date: point.reportDate, price: point.priceAvg })),
  };
}

export function judgePriceJump(supplierChangePct: number, marketChangePct: number | null): Verdict {
  if (marketChangePct == null || !Number.isFinite(supplierChangePct)) {
    return {
      kind: "no_comparison",
      label: "No USDA comparison",
      detail: "There is no USDA price on both sides of this change, so it is not called market-wide or specific to this supplier.",
    };
  }

  const gap = Math.abs(supplierChangePct - marketChangePct);
  if (supplierChangePct > 0 && marketChangePct > 0 && gap <= CLOSE_POINTS) {
    return {
      kind: "market_wide",
      label: "Market-wide",
      detail: `The public market rose ${signed(marketChangePct)}, close to this supplier's ${signed(supplierChangePct)}. The USDA series itself rose, so this looks market-wide and seasonal.`,
    };
  }

  if (supplierChangePct >= SUPPLIER_UP && (marketChangePct <= 0 || supplierChangePct - marketChangePct > CLOSE_POINTS)) {
    return {
      kind: "this_supplier",
      label: "This supplier",
      detail: `This supplier is ${signed(supplierChangePct)} and the public market is ${signed(marketChangePct)}. The extra increase looks specific to this supplier. Check the cheaper supplier already on file. The USDA report is not a place to buy.`,
    };
  }

  return {
    kind: "no_comparison",
    label: "No USDA comparison",
    detail: `This supplier is ${signed(supplierChangePct)} and the public market is ${signed(marketChangePct)}. Those moves are not close enough to call market-wide, and the supplier did not outrun a flat market.`,
  };
}

export type MarketExplanation = {
  usda: string;
  location: string;
  dates: string;
  verdict: string;
  detail: string;
};

// What one price-change row should say. Uncovered ingredients (limes, rice, chicken) never get a market percent.
export function explainMarket(args: {
  ingredient: string;
  supplierChangePct: number;
  since: string;
  quotes: QuotePoint[];
}): MarketExplanation {
  const family = ingredientFamily(args.ingredient);
  if (!family) {
    return {
      usda: "Not in these USDA reports",
      location: "—",
      dates: "—",
      verdict: "Not covered",
      detail: `${args.ingredient} is not in the USDA livestock or dairy reports this check uses. Compare it with your other suppliers.`,
    };
  }

  const move = marketMove(args.quotes, family, args.since);
  if (!move) {
    const which = family === "beef" ? "cattle" : "dairy";
    return {
      usda: "No price on both sides",
      location: "—",
      dates: "—",
      verdict: "No USDA comparison",
      detail: `${args.ingredient} maps to the public ${which} market, but the saved series has no price both on or before ${args.since} and after it.`,
    };
  }

  const verdict = judgePriceJump(args.supplierChangePct, move.changePct);
  const what = [move.commodity, move.className].filter(Boolean).join(", ");
  const where = move.location ?? "the reported market";
  return {
    usda: signed(move.changePct),
    location: where,
    dates: `${move.fromDate} → ${move.toDate}`,
    verdict: verdict.label,
    detail: `${what} (${move.priceUnit}) at ${where}, ${move.fromDate} to ${move.toDate}. ${verdict.detail}`,
  };
}
