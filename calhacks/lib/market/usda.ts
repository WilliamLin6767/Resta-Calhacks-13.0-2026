// Pull USDA AMS livestock and dairy prices through Apify.
// The token stays on the server. These rows are a market index, not a supplier.

import {
  asNumber,
  parseReportDate,
  quoteFamily,
  type IngredientFamily,
  type QuotePoint,
} from "@/lib/market/judge";

// Actor examples: 1237 is a feeder-cattle auction. 1034 is the actor's other sample slug.
// Only rows that classify as beef or dairy are stored. A slug the cache does not cover returns nothing.
export const USDA_ACTOR = "kevinserver24~usda-ams-market-news";
export const REPORT_SLUGS = ["1237", "1034"];

export type QuoteInsert = {
  source: "usda_ams";
  report_id: number | null;
  commodity: string | null;
  class: string | null;
  category: string | null;
  market_location: string | null;
  report_date: string;
  price_avg: number;
  price_low: number | null;
  price_high: number | null;
  price_unit: string | null;
  ingredient_family: IngredientFamily;
  cache_refreshed_at: string | null;
  created_at: string;
};

export type UsdaFetch = {
  items: unknown[];
  cacheRefreshedAt: string | null;
  slugsCovered: string[];
};

type RunData = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
  defaultKeyValueStoreId?: string;
};

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runFrom(body: unknown): RunData {
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: RunData }).data;
    if (data && typeof data === "object") return data;
  }
  return (body ?? {}) as RunData;
}

function messageFrom(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string } | string }).error;
    if (typeof error === "string") return error.slice(0, 300);
    if (error && typeof error.message === "string") return error.message.slice(0, 300);
  }
  return `Apify request failed (${status}).`;
}

// Start the actor, wait, and return dataset rows plus the cache summary.
export async function fetchUsdaMarket(token: string): Promise<UsdaFetch> {
  const start = await fetch(`https://api.apify.com/v2/acts/${USDA_ACTOR}/runs?waitForFinish=60`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ report_slugs: REPORT_SLUGS }),
    signal: AbortSignal.timeout(70_000),
  });
  const started = await readJson(start);
  if (!start.ok) throw new Error(messageFrom(started, start.status));

  let run = runFrom(started);
  for (let i = 0; i < 6 && run.status && !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const poll = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const polled = await readJson(poll);
    if (!poll.ok) throw new Error(messageFrom(polled, poll.status));
    run = runFrom(polled);
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Apify run ended ${run.status ?? "without a status"}.`);
  if (!run.defaultDatasetId) throw new Error("Apify run finished without a dataset.");

  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=1000`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const itemsBody = await readJson(itemsRes);
  if (!itemsRes.ok) throw new Error(messageFrom(itemsBody, itemsRes.status));
  const items = Array.isArray(itemsBody) ? itemsBody : [];

  let cacheRefreshedAt: string | null = null;
  let slugsCovered: string[] = [];
  if (run.defaultKeyValueStoreId) {
    const summaryRes = await fetch(
      `https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/SUMMARY.json`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (summaryRes.ok) {
      const summary = await readJson(summaryRes);
      if (summary && typeof summary === "object") {
        const record = summary as { cache_refreshed_at?: unknown; cache_slugs_covered?: unknown };
        if (typeof record.cache_refreshed_at === "string") cacheRefreshedAt = record.cache_refreshed_at;
        if (Array.isArray(record.cache_slugs_covered)) slugsCovered = record.cache_slugs_covered.map(String);
      }
    }
  }

  return { items, cacheRefreshedAt, slugsCovered };
}

function isoTimestamp(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function flattenItems(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && Array.isArray((item as { results?: unknown }).results)) {
      out.push(...(item as { results: unknown[] }).results);
    } else {
      out.push(item);
    }
  }
  return out;
}

// Keep cattle and dairy rows that have a date and an average price. One row per series per day.
export function quotesFromItems(items: unknown[], cacheRefreshedAt: string | null, createdAt: string): QuoteInsert[] {
  const byKey = new Map<string, QuoteInsert>();
  for (const item of flattenItems(items)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const family = quoteFamily({
      category: typeof row.category === "string" ? row.category : null,
      commodity: typeof row.commodity === "string" ? row.commodity : null,
      class: typeof row.class === "string" ? row.class : null,
    });
    const reportDate = parseReportDate(row.report_date);
    const priceAvg = asNumber(row.price_avg);
    if (!family || !reportDate || priceAvg == null) continue;

    const reportId = asNumber(row.report_id);
    const commodity = typeof row.commodity === "string" ? row.commodity : null;
    const className = typeof row.class === "string" ? row.class : null;
    const priceUnit = typeof row.price_unit === "string" ? row.price_unit : null;
    const key = [reportId ?? "", commodity ?? "", className ?? "", priceUnit ?? "", reportDate].join("|");
    byKey.set(key, {
      source: "usda_ams",
      report_id: reportId,
      commodity,
      class: className,
      category: typeof row.category === "string" ? row.category : null,
      market_location: typeof row.market_location === "string" ? row.market_location : null,
      report_date: reportDate,
      price_avg: priceAvg,
      price_low: asNumber(row.price_low),
      price_high: asNumber(row.price_high),
      price_unit: priceUnit,
      ingredient_family: family,
      cache_refreshed_at: isoTimestamp(cacheRefreshedAt),
      created_at: createdAt,
    });
  }
  return [...byKey.values()];
}

type StoredQuote = {
  report_id: number | null;
  commodity: string | null;
  class: string | null;
  price_unit: string | null;
  market_location: string | null;
  report_date: string | null;
  price_avg: number | null;
  ingredient_family: string | null;
};

// Rows read back from market_quotes, ready for explainMarket.
export function pointsFromRows(rows: StoredQuote[]): QuotePoint[] {
  const points: QuotePoint[] = [];
  for (const row of rows) {
    if (row.ingredient_family !== "beef" && row.ingredient_family !== "dairy") continue;
    const reportDate = parseReportDate(row.report_date ?? "");
    const priceAvg = asNumber(row.price_avg);
    if (!reportDate || priceAvg == null || row.report_id == null) continue;
    points.push({
      reportId: row.report_id,
      commodity: row.commodity ?? "",
      className: row.class ?? "",
      priceUnit: row.price_unit ?? "",
      marketLocation: row.market_location,
      reportDate,
      priceAvg,
      family: row.ingredient_family,
    });
  }
  return points;
}
