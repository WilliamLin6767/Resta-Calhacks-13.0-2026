// Revenue in a daypart (lunch or dinner, weekdays or weekends) fell. Pick what to promote from
// campaign_options and propose a campaign. Measured on plates of the promoted dish in that
// daypart against the same weekdays of the 4 weeks before, with the daypart's revenue and the
// discount's cost alongside.
import { loadDishes, loadSaleLines } from "@/lib/agent/evidence";
import type { Daypart } from "@/lib/agent/investigate";
import { detectSalesDips } from "../detect";
import { dishDaypartMetric } from "../measure";
import type { Playbook } from "../types";

const DAY = 86400_000;

export const salesDip: Playbook = {
  id: "sales_dip",
  title: "Sales dip",
  async detect(db) {
    const now = new Date();
    const [lines, dishes] = await Promise.all([loadSaleLines(db, new Date(now.getTime() - 43 * DAY).toISOString()), loadDishes(db)]);
    return detectSalesDips(lines, dishes, now.toISOString());
  },
  investigate: {
    tools: ["campaign_options", "compare_data", "get_dashboard_summary", "list_marketing_posts"],
    question:
      "Revenue in this daypart fell. Use campaign_options for the daypart to pick the dish worth promoting (margin, the dip, stock for a promo week, " +
      "when it was last posted) and one allowed offer. Draft the campaign with draft_campaign, then propose start_promotion for it.",
  },
  actions: ["draft_campaign", "start_promotion", "publish_post"],
  goal: () => ({ metric: "dish_daypart_units", label: "Plates of the promoted dish a day in that daypart", direction: "up", unit: "plates a day" }),
  window: { days: 14 },
  baseline: "same_weekdays_prior_4w",
  limits: { cooldownDays: 14, maxOpen: 2 },
  autonomy: "propose",
  async measure(db, c) {
    const dishId = Number(c.facts.promoted_dish_id ?? 0);
    const daypart = (c.facts.daypart as Daypart | undefined) ?? null;
    const lines = await loadSaleLines(db, new Date(Date.parse(c.window_start!) - 29 * DAY).toISOString());
    const m = dishDaypartMetric(lines, dishId, daypart, c.window_start!, c.window_end!);
    const discount = Number(c.facts.discount_usd ?? 0);
    return {
      value: m.value, baseline: m.baseline, sample: { days: m.days, orders: m.orders }, cost: Math.round(discount * m.units * 100) / 100, unit: "plates a day",
      item: String(c.facts.promoted_dish ?? ""), action: String(c.facts.offer ?? c.proposal?.action_tools.join(", ") ?? ""),
    };
  },
};
