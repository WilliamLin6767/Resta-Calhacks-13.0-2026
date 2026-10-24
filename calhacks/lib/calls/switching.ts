// After a call finds a supply problem (shortage, can't deliver in time, a price rise with no
// relief): should the owner switch suppliers? (server only)
//
//   1. switchImpact (pure)  what the shortage puts at risk, from the analytics digest and
//                           inventory: dishes, their sales and profit, days of stock left
//   2. leads                outside companies for that ingredient from the Apify ThomasNet
//                           scrape (supplier_leads); searched now if none are saved and
//                           APIFY_TOKEN is set
//   3. weighSwitch (Claude) pros vs cons; picks a lead only if the pros win
//   4. if it does           the lead is saved as a prospect supplier and a PENDING call to it
//                           is added (price, pack sizes, minimums, delivery; no ordering)
//
// Nothing is dialed here: the new call waits for the owner's "Approve and call" like any other.
// The result is stored in the original call's result.switch.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Digest } from "@/lib/analytics";
import { loadInventory } from "@/lib/inventory/service";
import { leadsFromItems } from "@/lib/market/leads";
import { searchThomasNet } from "@/lib/market/thomasnet";
import { RESTAURANT_ID } from "@/lib/supabase";
import { switchBrief, weighSwitch, type SwitchDecision } from "./ai";
import { normalizePhone } from "./phone";
import { today } from "./service";
import { callIngredient, needsSwitchCheck, type CallRow, type StoredResult, type SwitchCheck, type SwitchImpact, type SwitchLead } from "./types";

type Db = SupabaseClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data;
}

// ---------------------------------------------------------------------
// 1. What the shortage puts at risk (pure)
// ---------------------------------------------------------------------

export type ImpactInput = {
  ingredient: { id: number; name: string; unit: string };
  stock: { estimated: number; daily_use: number; days_left: number | null } | null;
  dishNames: string[]; // menu items whose recipe uses the ingredient
  digest: Pick<Digest, "menu" | "kpis" | "price_changes">;
  currentSupplier: { id: number; name: string };
  prices: { supplier_id: number; supplier: string; pack_qty: number; pack_desc: string | null; price: number; effective_date: string }[];
};

export function switchImpact(input: ImpactInput): SwitchImpact {
  const { ingredient, stock, digest, currentSupplier } = input;
  const wanted = new Set(input.dishNames);
  const dishes = digest.menu
    .filter((m) => wanted.has(m.name))
    .map((m) => ({ name: m.name, units_30d: m.units, revenue_30d: round2(m.revenue), gross_profit_30d: m.gross_profit === null ? null : round2(m.gross_profit), class: m.class }))
    .sort((a, b) => b.revenue_30d - a.revenue_30d);
  const revenue = round2(dishes.reduce((s, d) => s + d.revenue_30d, 0));
  const total = digest.kpis.cur?.revenue ?? 0;

  // The latest price per supplier for this ingredient.
  const latest = new Map<number, ImpactInput["prices"][number]>();
  for (const p of input.prices) {
    const seen = latest.get(p.supplier_id);
    if (!seen || p.effective_date > seen.effective_date) latest.set(p.supplier_id, p);
  }
  const current = latest.get(currentSupplier.id) ?? null;
  const change = digest.price_changes.find((c) => c.ingredient === ingredient.name && c.supplier === currentSupplier.name);
  const currentUnit = current && current.pack_qty > 0 ? current.price / current.pack_qty : null;

  return {
    ingredient: ingredient.name,
    unit: ingredient.unit,
    on_hand: stock?.estimated ?? 0,
    daily_use: stock?.daily_use ?? 0,
    days_left: stock?.days_left ?? null,
    dishes,
    revenue_at_risk_30d: revenue,
    share_of_revenue_pct: total > 0 ? Math.round((revenue / total) * 1000) / 10 : null,
    gross_profit_at_risk_30d: dishes.length && dishes.every((d) => d.gross_profit_30d !== null) ? round2(dishes.reduce((s, d) => s + (d.gross_profit_30d ?? 0), 0)) : null,
    current_supplier: currentSupplier.name,
    current_price: current ? { per_pack: current.price, pack_desc: current.pack_desc, since: current.effective_date, change_pct: change?.change_pct ?? null } : null,
    on_file_alternatives: [...latest.values()]
      .filter((p) => p.supplier_id !== currentSupplier.id && p.pack_qty > 0)
      .map((p) => ({
        supplier: p.supplier,
        per_pack: p.price,
        pack_desc: p.pack_desc,
        unit_cost: round2(p.price / p.pack_qty),
        current_unit_cost: currentUnit === null ? null : round2(currentUnit),
      })),
  };
}

// ---------------------------------------------------------------------
// 2-4. The full check
// ---------------------------------------------------------------------

type LeadRow = { company_name: string; phone: string; city: string | null; state: string | null; matched_product: string | null };
const fromThomasNet = (l: LeadRow): SwitchLead => ({ source: "thomasnet", ...l });

// Saved ThomasNet leads for this ingredient. Without any, search now when Apify is set up.
async function thomasNetLeads(db: Db, ingredient: string): Promise<{ leads: SwitchLead[]; searched: boolean; note?: string }> {
  const saved = (must(
    await db.from("supplier_leads").select("company_name, phone, city, state, matched_product").eq("source", "thomasnet").ilike("ingredient_name", ingredient),
    "load supplier leads (has supabase/12_supplier_leads.sql been run?)",
  ) ?? []) as LeadRow[];
  if (saved.length) return { leads: saved.map(fromThomasNet), searched: false };
  const token = process.env.APIFY_TOKEN;
  if (!token) return { leads: [], searched: false, note: "No ThomasNet leads are saved for this item, and APIFY_TOKEN isn't set on the server, so no new search could run." };
  // Adds to the saved leads; the Suppliers page's "Find suppliers" keeps refreshing the rest.
  const found = leadsFromItems(ingredient, await searchThomasNet(token, ingredient), new Date().toISOString());
  if (found.length) must(await db.from("supplier_leads").insert(found), "save supplier leads");
  return {
    leads: found.map((l) => fromThomasNet({ company_name: l.company_name, phone: l.phone, city: l.city, state: l.state, matched_product: l.matched_product })),
    searched: true,
    note: found.length ? undefined : "A new ThomasNet search found no food supplier with a phone for this item.",
  };
}

// Suppliers already on file (with a phone) that sell this item, besides the current one.
export function onFileLeads(
  suppliers: { id: number; name: string; phone: string | null }[],
  prices: { supplier_id: number; pack_desc: string | null; price: number; effective_date: string }[],
  currentSupplierId: number,
): SwitchLead[] {
  const latest = new Map<number, (typeof prices)[number]>();
  for (const p of prices) {
    const seen = latest.get(p.supplier_id);
    if (p.supplier_id !== currentSupplierId && (!seen || p.effective_date > seen.effective_date)) latest.set(p.supplier_id, p);
  }
  return suppliers.flatMap((s) => {
    const p = latest.get(s.id);
    if (!p || !s.phone || !normalizePhone(s.phone)) return [];
    const lead: SwitchLead = {
      source: "on_file",
      supplier_id: s.id,
      company_name: s.name,
      phone: s.phone,
      city: null,
      state: null,
      matched_product: `Already a supplier: sells it at $${p.price.toFixed(2)} per ${p.pack_desc ?? "pack"} (since ${p.effective_date})`,
    };
    return [lead];
  });
}

// A finished check that didn't add a call (nobody to switch to, or the pros didn't win) can run again.
export function canCheckAgain(row: Pick<CallRow, "status" | "brief" | "result">): boolean {
  const check = row.result?.switch;
  return (
    row.status === "completed" &&
    row.result?.supply_problem === true &&
    callIngredient(row) !== undefined &&
    !!check &&
    check.status !== "checking" &&
    check.follow_up_call_id === undefined
  );
}

// The lead as a supplier, so it can be called like any other: matched by phone, else added
// with notes saying it's only a prospect. It has no prices, so orders never pick it on their own.
async function prospectSupplier(db: Db, lead: SwitchLead, ingredient: string, category: string | null): Promise<number> {
  const phone = normalizePhone(lead.phone);
  const suppliers = (must(await db.from("suppliers").select("id, phone").eq("restaurant_id", RESTAURANT_ID), "load suppliers") ?? []) as { id: number; phone: string | null }[];
  const existing = suppliers.find((s) => phone !== null && normalizePhone(s.phone) === phone);
  if (existing) return existing.id;
  const row = must(
    await db
      .from("suppliers")
      .insert({
        restaurant_id: RESTAURANT_ID,
        name: lead.company_name,
        category,
        phone: lead.phone,
        preferred_channel: "phone",
        notes: `Prospect: found on ThomasNet (Apify) as a possible source of ${ingredient}${lead.city ? `, in ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}. Not ordered from yet.`,
      })
      .select("id")
      .single(),
    "save the new supplier",
  ) as { id: number };
  return row.id;
}

// Checks running in this server process, so two polls don't start the same check twice.
const running = new Set<number>();

// `again`: the owner asked to check again (e.g. after adding APIFY_TOKEN); see canCheckAgain.
export async function checkSwitch(
  db: Db,
  callId: number,
  opts: { again?: boolean; weigh?: typeof weighSwitch } = {},
): Promise<SwitchCheck | null> {
  const weigh = opts.weigh ?? weighSwitch;
  if (running.has(callId)) return null;
  running.add(callId);
  try {
    const load = async () => must(await db.from("call_requests").select("*").eq("id", callId).eq("restaurant_id", RESTAURANT_ID).maybeSingle(), "load the call") as CallRow | null;
    const row = await load();
    if (!row || !(needsSwitchCheck(row) || (opts.again && canCheckAgain(row)))) return null;
    const ingredientId = callIngredient(row)!;
    const save = async (check: SwitchCheck) => {
      const fresh = (await load()) ?? row;
      const result: StoredResult = { ...(fresh.result ?? {}), switch: check };
      must(await db.from("call_requests").update({ result }).eq("id", callId), "save the switch check");
      return check;
    };
    const startedAt = new Date().toISOString();
    await save({ status: "checking", checked_at: startedAt, ingredient_id: ingredientId });

    try {
      const [ingRes, supRes, recipeRes, priceRes, digestRes, inventory] = await Promise.all([
        db.from("ingredients").select("id, name, unit, category").eq("id", ingredientId).single(),
        db.from("suppliers").select("id, name, phone").eq("restaurant_id", RESTAURANT_ID),
        db.from("recipe_items").select("menu_items(name)").eq("ingredient_id", ingredientId),
        db.from("supplier_prices").select("supplier_id, pack_qty, pack_desc, price, effective_date").eq("ingredient_id", ingredientId),
        db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
        loadInventory(db),
      ]);
      const ingredient = must(ingRes, "load the ingredient") as { id: number; name: string; unit: string; category: string | null };
      const suppliers = (must(supRes, "load suppliers") ?? []) as { id: number; name: string; phone: string | null }[];
      const names = new Map(suppliers.map((s) => [s.id, s.name]));
      const dishNames = ((must(recipeRes, "load recipes") ?? []) as unknown as { menu_items: { name: string } | null }[]).flatMap((r) => (r.menu_items ? [r.menu_items.name] : []));
      const prices = ((must(priceRes, "load prices") ?? []) as { supplier_id: number; pack_qty: number; pack_desc: string | null; price: number; effective_date: string }[]).map((p) => ({
        ...p,
        pack_qty: Number(p.pack_qty),
        price: Number(p.price),
        supplier: names.get(p.supplier_id) ?? "Another supplier",
      }));
      const digest = must(digestRes, "load the analytics digest") as Digest;
      const line = inventory.lines.find((l) => l.id === ingredientId);
      const currentSupplier = { id: row.supplier_id, name: names.get(row.supplier_id) ?? "the current supplier" };

      const impact = switchImpact({
        ingredient,
        stock: line ? { estimated: line.estimated, daily_use: line.daily_use, days_left: line.days_left } : null,
        dishNames,
        digest,
        currentSupplier,
        prices,
      });

      // Candidates: suppliers on file that already sell it (the quickest switch), then ThomasNet leads.
      const outside = await thomasNetLeads(db, ingredient.name);
      const leads = [...onFileLeads(suppliers, prices, row.supplier_id), ...outside.leads];
      const { searched, note } = outside;
      const r = row.result ?? {};
      const decision: SwitchDecision = await weigh({
        today: today(),
        ingredient: ingredient.name,
        call: { supplier: currentSupplier.name, summary: row.outcome ?? r.summary ?? "", follow_up: r.follow_up ?? "", delivery_eta: r.delivery_eta ?? "", outcome: r.outcome ?? "" },
        impact,
        leads: leads.map((l, index) => ({ index, source: l.source, company_name: l.company_name, city: l.city, state: l.state, sells: l.matched_product })),
      });

      const check: SwitchCheck = {
        status: "done",
        checked_at: startedAt,
        ingredient_id: ingredientId,
        impact,
        leads_considered: leads.length,
        searched_apify: searched,
        recommend: false,
        verdict: decision.verdict.slice(0, 600),
        pros: decision.pros.slice(0, 5).map((s) => s.slice(0, 300)),
        cons: decision.cons.slice(0, 5).map((s) => s.slice(0, 300)),
        ...(!leads.length ? { no_leads_reason: note ?? "No other supplier on file sells this, and no ThomasNet leads were found." } : {}),
      };

      // The pros won and Claude picked a real lead with a usable phone: add the call to it (pending).
      const lead = decision.recommend_switch ? leads[decision.lead_index] : undefined;
      if (lead && normalizePhone(lead.phone)) {
        const supplierId = lead.supplier_id ?? (await prospectSupplier(db, lead, ingredient.name, ingredient.category));
        const made = must(
          await db
            .from("call_requests")
            .insert({
              restaurant_id: RESTAURANT_ID,
              supplier_id: supplierId,
              context_type: "ingredient",
              context_id: ingredientId,
              purpose: "info",
              title: (decision.call.title || `Ask ${lead.company_name} about ${ingredient.name}`).slice(0, 120),
              reason: (decision.call.reason || `${currentSupplier.name} reported a supply problem with ${ingredient.name}.`).slice(0, 600),
              brief: { ...switchBrief(decision), refs: { ingredient_id: ingredientId } },
              proposed_by: "ai",
            })
            .select("id")
            .single(),
          "save the call to the new supplier",
        ) as { id: number };
        check.recommend = true;
        check.lead = lead;
        check.follow_up_call_id = made.id;
      }
      return await save(check);
    } catch (err) {
      return await save({ status: "error", checked_at: startedAt, ingredient_id: ingredientId, error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    running.delete(callId);
  }
}
