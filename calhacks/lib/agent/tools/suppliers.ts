// Suppliers and the market: who we buy from and at what price, cached market quotes and leads,
// and refreshing those (the same as /api/market/usda and /api/market/thomasnet).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listCalls } from "@/lib/calls/service";
import { refreshThomasNet, refreshUsda, type Refreshed } from "@/lib/market/refresh";
import { RESTAURANT_ID } from "@/lib/supabase";
import { resolveOne } from "../resolve";
import { ask, capped, changed, json, defineTool, type AgentCtx } from "../types";

type Db = SupabaseClient;

const SUPPLIER_COLUMNS = "id, name, contact_name, phone, email, preferred_channel, lead_time_days, min_order_amount, delivery_days";

async function loadSuppliers(db: Db) {
  const res = await db.from("suppliers").select(SUPPLIER_COLUMNS).eq("restaurant_id", RESTAURANT_ID).order("name");
  if (res.error) throw new Error(`Could not load suppliers: ${res.error.message}`);
  return res.data as { id: number; name: string; contact_name: string | null; phone: string | null; email: string | null; preferred_channel: string | null; lead_time_days: number | null; min_order_amount: number | null; delivery_days: string | null }[];
}

export async function findSupplier(db: Db, query: string) {
  return resolveOne(await loadSuppliers(db), query, (s) => s.name, "supplier");
}

function refreshed(ctx: AgentCtx, what: string, result: Refreshed) {
  if (!result.ok) return { what, error: result.error };
  const stored = Number(result.body.stored ?? 0);
  changed(ctx, { kind: "market_refresh", label: `${what} refreshed: ${stored} saved`, before: null, after: stored });
  return { what, ...result.body };
}

export const supplierTools = [
  defineTool({
    name: "list_suppliers",
    description: "Every supplier with contact, how they take orders, lead time and minimum order.",
    input: z.object({}),
    run: async (_input, ctx) => json(capped(await loadSuppliers(ctx.db))),
  }),
  defineTool({
    name: "get_supplier",
    description: "One supplier: contact, their latest price for each item, and their recent supplier calls.",
    input: z.object({ supplier: z.string() }),
    run: async ({ supplier }, ctx) => {
      const found = await findSupplier(ctx.db, supplier);
      if (!found.ok) return ask(found.ask);
      const s = found.item;
      const [prices, calls] = await Promise.all([
        ctx.db.from("supplier_prices").select("ingredient_id, pack_desc, price, effective_date, ingredients(name)").eq("supplier_id", s.id).order("effective_date", { ascending: false }).limit(300),
        listCalls(ctx.db, { supplier_id: s.id }).catch(() => []),
      ]);
      type PriceRow = { ingredient_id: number; pack_desc: string | null; price: number; effective_date: string; ingredients: { name: string } | null };
      const latest = new Map<number, PriceRow>();
      for (const p of (prices.data ?? []) as unknown as PriceRow[]) if (!latest.has(p.ingredient_id)) latest.set(p.ingredient_id, p);
      return json({
        supplier: s,
        prices: capped([...latest.values()].map((p) => ({ item: p.ingredients?.name ?? "item", pack: p.pack_desc, price: Number(p.price), since: p.effective_date }))),
        calls: capped(calls.map((c) => ({ id: c.id, title: c.title, status: c.status, created_at: c.created_at, outcome: c.outcome })), 10),
      });
    },
  }),
  defineTool({
    name: "get_market_prices",
    description: "Cached market data, without refreshing it: USDA wholesale quotes and the outside suppliers found on ThomasNet.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const [quotes, leads] = await Promise.all([
        ctx.db.from("market_quotes").select("commodity, class, price_avg, price_unit, market_location, report_date, ingredient_family, cache_refreshed_at").order("report_date", { ascending: false }).limit(200),
        ctx.db.from("supplier_leads").select("ingredient_name, company_name, phone, city, state, matched_product").limit(100),
      ]);
      return json({ usda_quotes: capped(quotes.data ?? []), thomasnet_leads: capped(leads.data ?? [], 15) });
    },
  }),
  defineTool({
    name: "refresh_market_prices",
    description: "Fetch new market data through Apify: 'usda' (wholesale beef and dairy quotes), 'thomasnet' (outside suppliers for items whose price jumped), or 'both'. Slow, and limited to once every few minutes.",
    input: z.object({ which: z.enum(["usda", "thomasnet", "both"]) }),
    run: async ({ which }, ctx) => {
      const results = [];
      if (which !== "thomasnet") results.push(refreshed(ctx, "USDA quotes", await refreshUsda(ctx.db, ctx.identity)));
      if (which !== "usda") results.push(refreshed(ctx, "ThomasNet leads", await refreshThomasNet(ctx.db, ctx.identity)));
      return json(results);
    },
  }),
];
