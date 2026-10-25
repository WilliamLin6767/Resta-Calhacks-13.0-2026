// A supplier raised the price of something we buy. Investigate the cost, then propose a call to
// ask for the old price (or switch), or an order from a cheaper supplier. Measured on the unit
// cost of the next invoices against the previous ones.
import { loadInventory } from "@/lib/inventory/service";
import { ingredientFamily, marketMove } from "@/lib/market/judge";
import { QUOTE_COLUMNS } from "@/lib/market/refresh";
import { pointsFromRows } from "@/lib/market/usda";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { Digest } from "@/lib/analytics";
import { detectPriceRises } from "../detect";
import { unitCostMetric } from "../measure";
import type { Playbook } from "../types";

export const supplierPriceRise: Playbook = {
  id: "supplier_price_rise",
  title: "Supplier price rise",
  async detect(db) {
    const [digest, inventory, quotes] = await Promise.all([
      db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
      loadInventory(db),
      db.from("market_quotes").select(QUOTE_COLUMNS).eq("source", "usda_ams"),
    ]);
    if (digest.error || !digest.data) return [];
    const points = pointsFromRows((quotes.data ?? []) as Parameters<typeof pointsFromRows>[0]);
    const changes = (digest.data as Digest).price_changes ?? [];
    const marketPct = (ingredient: string) => {
      const family = ingredientFamily(ingredient);
      const since = changes.find((c) => c.ingredient === ingredient)?.since;
      return family && since ? (marketMove(points, family, since)?.changePct ?? null) : null;
    };
    return detectPriceRises(changes, inventory.lines, marketPct);
  },
  investigate: {
    tools: ["investigate_ingredient_cost", "get_supplier", "list_calls", "get_market_prices"],
    question:
      "A supplier raised this price. Use investigate_ingredient_cost to see why it costs more: is the whole market up, is another supplier cheaper, " +
      "has a call already been made? Then recommend one action and say what it's worth a week. If another supplier is cheaper, propose a call to the current " +
      "supplier asking them to match that price (name the price and the supplier in the request). Otherwise ask for the old price back. " +
      "Don't propose a call that only confirms information, and don't propose one if a call about this is already pending.",
  },
  actions: ["propose_call", "place_call", "draft_order_plan", "approve_purchase_order"],
  goal: (facts) => ({ metric: "unit_cost", label: `${String(facts.ingredient ?? "The item")} cost per ${String(facts.unit ?? "unit")} on invoices`, direction: "down", unit: "$" }),
  window: { days: 14 },
  baseline: "previous_invoices",
  limits: { cooldownDays: 14, maxOpen: 3 },
  autonomy: "propose",
  async measure(db, c) {
    const ingredientId = Number(c.facts.ingredient_id);
    const res = await db
      .from("invoice_lines")
      .select("unit_price, pack_qty, invoices!inner(invoice_date, restaurant_id)")
      .eq("ingredient_id", ingredientId)
      .eq("invoices.restaurant_id", RESTAURANT_ID)
      .limit(200);
    if (res.error) throw new Error(`Could not load invoice lines: ${res.error.message}`);
    const lines = (res.data as unknown as { unit_price: number; pack_qty: number | null; invoices: { invoice_date: string } }[]).map((l) => ({
      invoice_date: l.invoices.invoice_date, unit_price: Number(l.unit_price), pack_qty: l.pack_qty === null ? null : Number(l.pack_qty),
    }));
    const m = unitCostMetric(lines, c.window_start!, c.window_end!);
    const days = Math.round((Date.parse(c.window_end!) - Date.parse(c.window_start!)) / 86400_000);
    return { value: m.value, baseline: m.baseline, sample: { days, orders: m.invoices }, cost: 0, unit: "$", item: String(c.facts.ingredient ?? ""), action: c.proposal?.action_tools.join(", ") ?? "" };
  },
};
