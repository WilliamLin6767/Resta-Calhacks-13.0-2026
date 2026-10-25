// Claude turns the cash plan into a short money plan for the owner (server only). Code works out
// every number (forecast.ts); the AI only puts them in order and explains them. Cash management,
// not investment advice: it never names an investment, and the owner approves any move.
// Saved in ai_tab_summaries (tab "money") and rewritten only when the numbers change.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createRateLimiter } from "@/lib/aiLimits";
import { ask } from "@/lib/purchasing/ai";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { Money } from "./cashPlan";

type Db = SupabaseClient;

export const MoneyPlanSchema = z.object({
  headline: z.string(), // one sentence: where cash stands over the next two weeks
  status: z.enum(["good", "watch", "act"]),
  steps: z.array(z.object({ title: z.string(), why: z.string() })), // up to 3, most important first
});
export type MoneyPlan = z.infer<typeof MoneyPlanSchema>;

// Bump when the instructions change, so plans saved under the old ones are rewritten
const PLAN_VERSION = 3;
const dailyLimit = createRateLimiter({ limit: 100, windowMs: 24 * 60 * 60 * 1000 });

const SYSTEM =
  "You write a short money plan for the owner of a small Vietnamese restaurant, from numbers a program already worked out. " +
  "The account is the restaurant's supplies account at Capital One (through its Nessie API): delivery-app payouts come in, supplier bills go out. The forecast is an estimate. Don't call the account simulated or a demo. " +
  "This is cash management, not investment advice: never name or recommend an investment, fund, stock or account product. Moving money to savings is the furthest you go, and only the amount given. " +
  "headline: one plain sentence, at most 20 words, on where cash stands over the next 14 days, with one number. Talk to the owner (you, your). " +
  "status: act if cash is forecast to go below the reserve or money is missing from the bank, watch if food cost is over target or cash gets close to the reserve, good otherwise. " +
  "steps: at most 3, most important first, each something the owner can do this week: a title of at most 7 words, and why in at most 22 words with one number. " +
  "Use only numbers from the facts; never invent any. Write dollars with commas and no cents, like $1,002. Don't repeat the same number in every step.";

// The numbers the plan is written from, kept small so the hash only changes when something matters
export function moneyFacts(m: Money) {
  const f = m.forecast;
  const r = (n: number) => Math.round(n);
  return {
    balance_now: r(f.start),
    cash_reserve: r(f.reserve),
    bills_due_this_week: r(m.bank.cash.bills_due),
    forecast_14_days: {
      money_in: r(f.money_in), money_out: r(f.money_out), usual_supplier_spend_per_day: r(f.daily_spend),
      lowest: { date: f.lowest.date, balance: r(f.lowest.balance) }, first_day_below_reserve: f.first_below,
      ends_at: r(f.days[f.days.length - 1].balance),
      big_days: f.days.filter((d) => d.events.length).map((d) => ({ date: d.date, events: d.events.map((e) => `${e.label} ${e.amount > 0 ? "+" : "-"}$${r(Math.abs(e.amount))}`) })),
    },
    savings: m.move.kind === "now" ? { can_move_now: m.move.amount, lowest_after_moving: r(m.move.lowest_after) }
      : m.move.kind === "later" ? { can_move_after: m.move.date, amount: m.move.amount } : "nothing spare to move",
    already_in_savings: m.bank.savings ?? 0,
    money_missing_from_bank: m.bank.owed,
    food_budget: m.budget && {
      days: m.budget.days, sales: r(m.budget.sales), target_pct: m.budget.target_pct, food_used: r(m.budget.used), food_pct: m.budget.pct,
      room_left: r(m.budget.left), biggest_food_costs: m.budget.top.map((t) => `${t.name} $${r(t.food_cost)} (${t.share}%)`),
    },
  };
}

function hashOf(facts: ReturnType<typeof moneyFacts>) {
  return createHash("sha256").update(`v${PLAN_VERSION}:${JSON.stringify(facts)}`).digest("hex").slice(0, 32);
}

// The saved plan for these numbers, else a new one
export async function moneyPlan(db: Db, m: Money): Promise<MoneyPlan> {
  const facts = moneyFacts(m);
  const hash = hashOf(facts);
  const saved = await db.from("ai_tab_summaries").select("summary").eq("restaurant_id", RESTAURANT_ID).eq("tab", "money").eq("facts_hash", hash)
    .order("created_at", { ascending: false }).limit(1);
  const parsed = MoneyPlanSchema.safeParse(saved.data?.[0]?.summary);
  if (parsed.success) return parsed.data;

  if (!dailyLimit("all").ok) throw new Error("Too many AI money plans today.");
  const plan = await ask(SYSTEM, JSON.stringify(facts, null, 1), MoneyPlanSchema, "low");
  plan.steps = plan.steps.slice(0, 3);
  await db.from("ai_tab_summaries").insert({ restaurant_id: RESTAURANT_ID, tab: "money", facts_hash: hash, summary: plan });
  return plan;
}
