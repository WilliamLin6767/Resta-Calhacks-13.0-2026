// The menu: prices, cost to make and margins (the Menu page). Changing a price, in the app or on
// the delivery apps, is a Commit action the owner approves (Phase 3), so nothing here writes.
import { z } from "zod";
import { loadPricing } from "@/lib/pricing/service";
import { capped, json, round2, defineTool } from "../types";

export const menuTools = [
  defineTool({
    name: "list_menu",
    tier: "read",
    area: "menu",
    description: "Every dish: price, delivery-app price, cost to make now, food cost %, margin, sales in the period, and the suggested price if it should change. Also the delivery-app prices that are too low.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const p = await loadPricing(ctx.db);
      return json({
        costs_compared_with: p.since,
        dishes: capped(p.suggestions.map((s) => ({
          id: s.dish.id, name: s.dish.name, price: s.dish.price, delivery_price: s.dish.delivery_price ?? s.dish.price,
          cost: round2(s.cost_now), cost_change_pct: s.cost_change_pct, food_cost_pct: s.food_cost_pct, margin: round2(s.dish.price - s.cost_now),
          sold: s.dish.units, suggestion: s.action === "ok" ? null : { action: s.action, new_price: s.new_price, reasons: s.reasons },
        }))),
        delivery_apps: { keep_pct: 100 - p.delivery.fee_pct, too_low: p.delivery.prices.map((d) => ({ name: d.name, now: d.delivery_price, suggested: d.new_delivery_price })) },
      });
    },
  }),
];
