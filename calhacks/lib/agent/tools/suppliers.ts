// Suppliers and the market: who we buy from and at what price, cached market quotes and leads,
// and refreshing those (the same as /api/market/usda and /api/market/thomasnet).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listCalls } from "@/lib/calls/service";
import { loadAnalytics } from "@/app/analytics/data";
import { loadInventory } from "@/lib/inventory/service";
import { explainMarket } from "@/lib/market/judge";
import { QUOTE_COLUMNS, refreshThomasNet, refreshUsda, type Refreshed } from "@/lib/market/refresh";
import { pointsFromRows } from "@/lib/market/usda";
import { loadDishes, loadFlags } from "../evidence";
import { ingredientCost } from "../investigate";
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
    name: "investigate_ingredient_cost",
    tier: "read",
    area: "suppliers",
    description:
      "Why an ingredient costs what it does: our supplier's price history, the change and what it adds a week, recent invoices and their flags, " +
      "the USDA market check (beef and dairy), other suppliers' prices with the weekly saving, past supplier calls, and the dishes whose margin it hits.",
    input: z.object({ ingredient: z.string() }),
    run: async ({ ingredient }, ctx) => {
      const list = await ctx.db.from("ingredients").select("id, name, unit, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID).order("name");
      if (list.error) return `Error: ${list.error.message}`;
      const found = resolveOne(list.data as { id: number; name: string; unit: string; preferred_supplier_id: number | null }[], ingredient, (i) => i.name, "ingredient");
      if (!found.ok) return ask(found.ask);
      const ing = found.item;
      const [prices, lines, flags, quotes, calls, recipes, dishes, inventory, analytics] = await Promise.all([
        ctx.db.from("supplier_prices").select("supplier_id, pack_desc, pack_qty, price, effective_date, suppliers(name)").eq("ingredient_id", ing.id).order("effective_date", { ascending: false }).limit(60),
        ctx.db.from("invoice_lines").select("qty, unit_price, pack_qty, invoices!inner(id, invoice_number, invoice_date, restaurant_id, suppliers(name))").eq("ingredient_id", ing.id).eq("invoices.restaurant_id", RESTAURANT_ID).order("id", { ascending: false }).limit(10),
        loadFlags(ctx.db, { ingredientId: ing.id, includeResolved: true }),
        ctx.db.from("market_quotes").select(QUOTE_COLUMNS).eq("source", "usda_ams"),
        ctx.db.from("call_requests").select("id, title, status, outcome, created_at, brief").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(100),
        ctx.db.from("recipe_items").select("menu_item_id, qty").eq("ingredient_id", ing.id),
        loadDishes(ctx.db),
        loadInventory(ctx.db),
        ctx.digest ? Promise.resolve({ digest: ctx.digest }) : loadAnalytics(ctx.days),
      ]);
      for (const r of [prices, lines, recipes]) if (r.error) return `Error: ${r.error.message}`;
      const digest = "digest" in analytics ? analytics.digest : null;
      const change = digest?.price_changes.find((c) => c.ingredient.trim().toLowerCase() === ing.name.trim().toLowerCase());
      const market = change
        ? explainMarket({ ingredient: ing.name, supplierChangePct: change.change_pct, since: change.since, quotes: pointsFromRows((quotes.data ?? []) as Parameters<typeof pointsFromRows>[0]) })
        : null;
      type PriceRow = { supplier_id: number; pack_desc: string | null; pack_qty: number; price: number; effective_date: string; suppliers: { name: string } | null };
      type LineRow = { qty: number; unit_price: number; pack_qty: number | null; invoices: { id: number; invoice_number: string | null; invoice_date: string; suppliers: { name: string } | null } };
      type CallRow = { id: number; title: string; status: string; outcome: string | null; created_at: string; brief: { refs?: { ingredient_id?: number; ingredient_ids?: number[] } } };
      const line = inventory.lines.find((l) => l.id === ing.id);
      return json(
        ingredientCost({
          ingredient: ing,
          preferredSupplierId: ing.preferred_supplier_id,
          prices: (prices.data as unknown as PriceRow[]).map((p) => ({ supplier_id: p.supplier_id, supplier: p.suppliers?.name ?? "A supplier", pack_desc: p.pack_desc, pack_qty: Number(p.pack_qty), price: Number(p.price), effective_date: p.effective_date })),
          invoiceLines: (lines.data as unknown as LineRow[]).map((l) => ({ invoice_id: l.invoices.id, invoice_number: l.invoices.invoice_number, invoice_date: l.invoices.invoice_date, supplier: l.invoices.suppliers?.name ?? "A supplier", qty: Number(l.qty), unit_price: Number(l.unit_price), pack_qty: l.pack_qty === null ? null : Number(l.pack_qty) })),
          flags,
          market,
          calls: ((calls.data ?? []) as CallRow[])
            .filter((c) => c.brief?.refs?.ingredient_id === ing.id || c.brief?.refs?.ingredient_ids?.includes(ing.id) || c.title.toLowerCase().includes(ing.name.toLowerCase()))
            .map((c) => ({ id: c.id, title: c.title, status: c.status, outcome: c.outcome, created_at: c.created_at })),
          recipes: (recipes.data as { menu_item_id: number; qty: number }[]).map((r) => ({ menu_item_id: r.menu_item_id, qty: Number(r.qty) })),
          dishes,
          menu: digest?.menu ?? [],
          days: digest?.period.days ?? ctx.days,
          weeklyUse: line ? line.daily_use * 7 : null,
        }),
      );
    },
  }),
  defineTool({
    name: "list_suppliers",
    tier: "read",
    area: "suppliers",
    description: "Every supplier with contact, how they take orders, lead time and minimum order.",
    input: z.object({}),
    run: async (_input, ctx) => json(capped(await loadSuppliers(ctx.db))),
  }),
  defineTool({
    name: "get_supplier",
    tier: "read",
    area: "suppliers",
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
    tier: "read",
    area: "suppliers",
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
    tier: "record",
    area: "suppliers",
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
