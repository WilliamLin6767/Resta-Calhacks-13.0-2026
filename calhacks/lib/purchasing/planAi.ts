// Claude explains an order plan to the owner (server only). It gets the plan code already worked out
// (plan.ts) and only puts it into words: it doesn't choose suppliers or change amounts.
import { z } from "zod";
import { ask } from "./ai";
import type { Plan } from "./plan";

const ExplainSchema = z.object({
  summary: z.string(), // 2-3 sentences: what to order, from whom, and the main trade-off
  suppliers: z.array(z.object({ supplier_id: z.number().int(), note: z.string() })), // one sentence each
  next_steps: z.array(z.string()), // short actions for the owner, e.g. "Add a case of fish sauce to reach Mekong's $500 minimum"
});
export type PlanExplanation = z.infer<typeof ExplainSchema>;

const SYSTEM =
  "You help the owner of a small Vietnamese restaurant decide what to order. You get an order plan that was already calculated: " +
  "for each item, every supplier with a price (cost for the packs needed, earliest delivery, whether it arrives in time), which supplier was chosen, " +
  "each supplier's order minimum, and the savings compared with the usual (preferred) suppliers. " +
  "Explain it in plain words a busy owner understands. Use only numbers from the plan; never invent prices, dates or suppliers. " +
  "Point out trade-offs: money saved vs. a later delivery, orders under a supplier's minimum, items no one can deliver in time. " +
  "summary: 2-3 sentences. suppliers: one sentence per supplier in the plan. next_steps: up to 4 short actions, or none.";

export async function explainPlan(plan: Plan, context: string): Promise<PlanExplanation> {
  const compact = {
    context,
    needed_by: plan.needed_by,
    total: plan.total,
    usual_total: plan.usual_total,
    savings: plan.savings,
    orders: plan.groups.map((g) => ({
      supplier_id: g.supplier_id, supplier: g.supplier, total: g.total, minimum: g.min_order_amount,
      below_minimum_by: g.below_minimum, earliest_delivery: g.arrives, late: g.late,
      items: g.lines.map((l) => ({
        item: l.name, need: `${l.qty} ${l.unit}`, why_needed: l.note,
        chosen: { packs: l.choice.packs, pack: l.choice.pack_desc, cost: l.choice.cost },
        options: l.options.map((o) => ({ supplier: o.supplier, cost: o.cost, arrives: o.arrives, on_time: o.on_time })),
      })),
    })),
    cant_order: plan.cant_order.map((n) => n.name),
  };
  return ask(SYSTEM, JSON.stringify(compact, null, 1), ExplainSchema, "low");
}
