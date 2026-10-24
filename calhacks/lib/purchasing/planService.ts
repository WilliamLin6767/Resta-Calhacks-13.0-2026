// Order plans on top of Supabase (server only).
//   buildPlan - what to order (low stock, or a prep day's shortfalls) and from which supplier
//   draftPlan - the same plan, as one draft purchase order per supplier for the owner to approve
import type { SupabaseClient } from "@supabase/supabase-js";
import { lowStockNeeds } from "@/lib/inventory/service";
import { prepShortNeeds } from "@/lib/prep/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { choiceReason, planOrders, type Plan } from "./plan";
import { loadSources } from "./sources";

type Db = SupabaseClient;

export type PlanRequest = { kind: "low" } | { kind: "prep"; date: string; factors: Record<number, number> };

function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export async function buildPlan(db: Db, req: PlanRequest): Promise<{ plan: Plan; label: string }> {
  const { needs, label } = req.kind === "low" ? await lowStockNeeds(db) : await prepShortNeeds(db, req.date, req.factors);
  const { offers, suppliers, preferred } = await loadSources(db, todayLocal());
  const plan = planOrders(needs, offers, suppliers, preferred, req.kind === "prep" ? req.date : null);
  return { plan, label };
}

// Works the plan out again (so the browser can't send its own) and drafts it
export async function draftPlan(db: Db, req: PlanRequest) {
  const { plan, label } = await buildPlan(db, req);
  const created: number[] = [];
  for (const g of plan.groups) {
    const items = g.lines.map((l) => `${l.name}: ${l.note} (${choiceReason(l)})`).join("; ");
    const warnings = [
      g.late ? "Their earliest delivery is after the day it's needed." : "",
      g.below_minimum > 0 ? `This order is $${g.below_minimum.toFixed(2)} under their $${g.min_order_amount.toFixed(2)} minimum.` : "",
    ].filter(Boolean).join(" ");
    const po = must(
      await db.from("purchase_orders").insert({
        restaurant_id: RESTAURANT_ID, supplier_id: g.supplier_id, status: "draft", created_by: "ai",
        expected_date: plan.needed_by, reason: `${label} ${items}.${warnings ? ` ${warnings}` : ""}`,
      }).select("id").single(),
      "create the order",
    ) as { id: number };
    must(
      await db.from("purchase_order_lines").insert(
        g.lines.map((l) => ({ purchase_order_id: po.id, ingredient_id: l.ingredient_id, qty: l.choice.packs, est_unit_price: l.choice.cost / l.choice.packs })),
      ),
      "add the order lines",
    );
    created.push(po.id);
  }
  return created;
}
