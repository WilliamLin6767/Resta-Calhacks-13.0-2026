// Loads the operating picture (server only). Every source goes through the service its own page
// uses, in parallel; one that fails is reported as unavailable instead of breaking the rest. The
// result is cached for a few minutes, since the agent reads it on every turn and the page on every
// visit; "refresh" rebuilds it, and a dismissed finding or a new proposal shows up on the next build.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAccounting } from "@/lib/accounting/service";
import type { Bill } from "@/lib/accounting/reconcile";
import { loadDishes, loadRecipes, loadSaleLines } from "@/lib/agent/evidence";
import type { Digest } from "@/lib/analytics";
import { loadTop } from "@/lib/attention/service";
import { loadMoney } from "@/lib/bank/cashPlan";
import { loadInventory } from "@/lib/inventory/service";
import { listCases } from "@/lib/loop/store";
import { loadOrders } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { buildPicture } from "./picture";
import type { ActionLite, BillLite, Loaded, MoneyLite, Picture, PostLite, Source, WasteRow } from "./types";

type Db = SupabaseClient;
const DAY = 86400_000;
export const PICTURE_TTL_MS = 5 * 60 * 1000;

async function source<T>(load: () => Promise<T>): Promise<Source<T>> {
  try {
    return { ok: true, data: await load(), at: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), at: new Date().toISOString() };
  }
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

const billLite = (b: Bill): BillLite => ({
  id: b.id, invoice_number: b.invoice_number, supplier: b.supplier, due_date: b.due_date, total: b.total, disputed: b.disputed, dispute_status: b.dispute?.status ?? null,
});

export async function loadSources(db: Db, now = new Date()): Promise<Loaded> {
  const since = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const accounting = source(() => loadAccounting(db));

  const [digest, inventory, waste, sales, orders, money, posts, cases, actions, findings] = await Promise.all([
    source(async () => {
      const res = await db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 });
      return must(res, "load the analytics digest") as Digest;
    }),
    source(async () => {
      const inv = await loadInventory(db);
      return { lines: inv.lines, wasteWeek: inv.wasteWeek };
    }),
    source(async () => {
      const rows = must(
        await db.from("stock_events").select("ingredient_id, change, unit_cost, reason, created_at, ingredients(name, unit)")
          .eq("restaurant_id", RESTAURANT_ID).eq("kind", "waste").gte("created_at", since(14)),
        "load the waste log",
      ) as unknown as { ingredient_id: number; change: number; unit_cost: number | null; reason: string | null; created_at: string; ingredients: { name: string; unit: string } | null }[];
      return rows.map((r): WasteRow => ({
        ingredient_id: r.ingredient_id, name: r.ingredients?.name ?? `Ingredient ${r.ingredient_id}`, unit: r.ingredients?.unit ?? "",
        qty: -Number(r.change), cost: -Number(r.change) * Number(r.unit_cost ?? 0), reason: r.reason, created_at: r.created_at,
      }));
    }),
    source(async () => {
      const [lines, dishes, recipes] = await Promise.all([loadSaleLines(db, since(43)), loadDishes(db), loadRecipes(db)]);
      return { lines, dishes: dishes.map((d) => ({ id: d.id, name: d.name })), recipes: recipes.map((r) => ({ ...r, qty: Number(r.qty) })) };
    }),
    source(async () => (await loadOrders(db)).map((o) => ({ id: o.id, status: o.status, supplier: o.supplier, total: o.total, created_by: o.created_by, reason: o.reason }))),
    source(async (): Promise<MoneyLite> => {
      const acc = await accounting;
      if (!acc.ok) throw new Error(acc.error);
      const bills = { overdue: acc.data.bills.overdue.map(billLite), due_soon: acc.data.bills.due_soon.map(billLite), later: acc.data.bills.later.map(billLite) };
      const m = await loadMoney(db, acc.data).catch(() => null);
      if (!m) return { connected: false, balance: null, reserve: null, lowest: null, first_below: null, bills };
      return { connected: true, balance: m.bank.cash.balance, reserve: m.forecast.reserve, lowest: m.forecast.lowest, first_below: m.forecast.first_below, bills };
    }),
    source(async () => must(
      await db.from("marketing_posts").select("dish_name, status, created_at, posted_at").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(60),
      "load marketing posts",
    ) as PostLite[]),
    source(() => listCases(db, { limit: 30 })),
    source(async () => must(
      await db.from("agent_actions").select("id, case_id, tool, title, status, source, created_at, done_at").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(30),
      "load the action log (has supabase/18_agent_actions.sql been run?)",
    ) as ActionLite[]),
    source(async () => (await loadTop(db, 8)).map((f) => ({ key: f.key, title: f.title, tab: f.tab, level: f.level, impact_usd_week: f.impact_usd_week ?? null }))),
  ]);

  return { now: now.toISOString(), digest, inventory, waste, sales, orders, money, posts, cases, actions, findings };
}

let cached: { at: number; picture: Picture } | null = null;
let building: Promise<Picture> | null = null;

export async function loadPicture(db: Db, opts: { fresh?: boolean } = {}): Promise<Picture> {
  if (!opts.fresh && cached && Date.now() - cached.at < PICTURE_TTL_MS) return cached.picture;
  // Two callers at once (the page and a chat turn) share one build
  building ??= loadSources(db)
    .then(buildPicture)
    .then((picture) => {
      cached = { at: Date.now(), picture };
      return picture;
    })
    .finally(() => {
      building = null;
    });
  return building;
}

// For a chat turn: the picture if it's ready within `ms`, else null (the build carries on and is
// cached for the next turn), so a cold cache never holds up an answer.
export async function pictureWithin(db: Db, ms: number): Promise<Picture | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([loadPicture(db), late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// After the owner approves, rejects or the loop moves a case, the next read rebuilds.
export function clearPicture() {
  cached = null;
}
