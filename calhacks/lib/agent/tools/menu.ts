// The menu: prices, cost to make and margins (the Menu page), and raising the delivery-app prices
// that are too low (the same service as /api/menu/delivery-prices).
import { z } from "zod";
import { signalAfter } from "@/lib/live/signal";
import { applyDeliveryPrices, loadPricing } from "@/lib/pricing/service";
import { capped, changed, json, round2, defineTool } from "../types";

export const menuTools = [
  defineTool({
    name: "list_menu",
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
  defineTool({
    name: "refresh_delivery_prices",
    description: "Set every delivery-app price that's too low (after the apps' commission) to the suggested one, as the Menu page's button does. Changes real menu prices: only when the owner asks for it.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const { delivery } = await loadPricing(ctx.db);
      if (!delivery.prices.length) return json({ ok: true, changed: 0, note: "Every delivery-app price is fine already." });
      const count = await applyDeliveryPrices(ctx.db);
      signalAfter("/api/menu/delivery-prices");
      const shown = delivery.prices.slice(0, 4).map((d) => `${d.name} $${d.delivery_price.toFixed(2)} to $${d.new_delivery_price.toFixed(2)}`);
      return changed(ctx, {
        kind: "delivery_prices",
        label: `${count} delivery-app price${count === 1 ? "" : "s"} raised: ${shown.join(", ")}${count > shown.length ? ", and more" : ""}`,
        before: null,
        after: count,
      });
    },
  }),
];
