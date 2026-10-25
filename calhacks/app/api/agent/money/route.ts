import { PLATFORMS } from "@/lib/accounting/reconcile";
import { loadMoney } from "@/lib/bank/cashPlan";
import { handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

// GET /api/agent/money
// The simulated bank (Capital One Nessie) and the 14-day cash plan, as plain data for the
// Fetch.ai agents (calhacks/agents). Read only.
export async function GET() {
  try {
    const money = await loadMoney(await getSupabase());
    if (!money) return Response.json({ connected: false });
    const { bank, forecast: f, move, budget } = money;
    return Response.json({
      connected: true,
      simulated: true,
      cash: bank.cash,
      savings: bank.savings,
      missing_from_bank: bank.problems.map((c) => ({ app: PLATFORMS[c.week.platform], week_of: c.week.period_start, owed: c.shortfall, note: c.message })),
      forecast: {
        lowest: f.lowest, first_day_below_reserve: f.first_below, ends_at: f.days[f.days.length - 1].balance,
        money_in: f.money_in, money_out: f.money_out,
        key_days: f.days.filter((d) => d.events.length).map((d) => ({ date: d.date, events: d.events })),
      },
      savings_suggestion: move,
      food_budget: budget,
    });
  } catch (err) {
    return handleError(err);
  }
}
