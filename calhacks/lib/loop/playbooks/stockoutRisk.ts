// Something runs out before its supplier can deliver. Look at the restock options and draft the
// order; the owner approves it. Measured on stockout days in the window (the goal: none).
import type { Digest } from "@/lib/analytics";
import { stockoutImpact } from "@/lib/attention/impact";
import { loadInventory } from "@/lib/inventory/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { detectStockouts } from "../detect";
import { stockoutDays } from "../measure";
import type { Playbook } from "../types";

export const stockoutRisk: Playbook = {
  id: "stockout_risk",
  title: "Stockout risk",
  async detect(db) {
    const [inventory, ingredients, suppliers, recipes, dishes, digest] = await Promise.all([
      loadInventory(db),
      db.from("ingredients").select("id, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID),
      db.from("suppliers").select("id, lead_time_days").eq("restaurant_id", RESTAURANT_ID),
      db.from("recipe_items").select("menu_item_id, ingredient_id"),
      db.from("menu_items").select("id, name").eq("restaurant_id", RESTAURANT_ID).eq("active", true),
      db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
    ]);
    const lead = new Map(((suppliers.data ?? []) as { id: number; lead_time_days: number | null }[]).map((s) => [s.id, Math.max(1, Number(s.lead_time_days ?? 1))]));
    const preferred = new Map(((ingredients.data ?? []) as { id: number; preferred_supplier_id: number | null }[]).map((i) => [i.id, i.preferred_supplier_id]));
    // What a day without each ingredient costs: the dishes that use it, units a day x margin
    const d = digest.data as Digest | null;
    const menu = new Map((d?.menu ?? []).map((m) => [m.name, m]));
    const days = d?.period?.days ?? 30;
    const dishName = new Map(((dishes.data ?? []) as { id: number; name: string }[]).map((x) => [x.id, x.name]));
    const usedIn = (ingredientId: number) =>
      ((recipes.data ?? []) as { menu_item_id: number; ingredient_id: number }[])
        .filter((r) => r.ingredient_id === ingredientId)
        .flatMap((r) => {
          const row = menu.get(dishName.get(r.menu_item_id) ?? "");
          return row && row.unit_margin !== null ? [{ name: row.name, unitsPerDay: row.units / days, margin: row.unit_margin }] : [];
        });
    return detectStockouts(inventory.lines, (id) => lead.get(preferred.get(id) ?? -1) ?? 1, (id, short) => stockoutImpact(usedIn(id), short));
  },
  investigate: {
    tools: ["restock_options", "check_ingredient", "list_purchase_orders"],
    question:
      "This ingredient runs out before a delivery can arrive. Check restock_options (what to order, from whom, what it costs, cash after) and open orders, " +
      "draft the order with draft_restock_for_week (it covers the next 7 days), then propose approve_purchase_order for that draft order number.",
  },
  actions: ["draft_restock_for_week", "draft_restock", "draft_order_plan", "approve_purchase_order"],
  goal: (facts) => ({ metric: "stockout_days", label: `Days ${String(facts.ingredient ?? "it")} was out`, direction: "down", target: 0, unit: "days" }),
  window: { days: 7 },
  baseline: "none",
  limits: { cooldownDays: 3, maxOpen: 5 },
  autonomy: "propose",
  async measure(db, c) {
    const res = await db
      .from("stock_events")
      .select("created_at, qty_after")
      .eq("restaurant_id", RESTAURANT_ID)
      .eq("ingredient_id", Number(c.facts.ingredient_id))
      .gte("created_at", c.window_start!)
      .lt("created_at", c.window_end!);
    if (res.error) throw new Error(`Could not load stock changes: ${res.error.message}`);
    const days = Math.round((Date.parse(c.window_end!) - Date.parse(c.window_start!)) / 86400_000);
    return {
      value: stockoutDays((res.data ?? []) as { created_at: string; qty_after: number }[], c.window_start!, c.window_end!),
      baseline: 0, sample: { days, orders: 0 }, cost: 0, unit: "days", item: String(c.facts.ingredient ?? ""), action: c.proposal?.action_tools.join(", ") ?? "",
    };
  },
};
