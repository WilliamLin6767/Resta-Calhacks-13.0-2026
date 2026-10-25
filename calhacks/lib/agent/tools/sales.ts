// Customer sales: the receipts added recently, and recording a sale by dish name (the same service
// as /api/sales/receipts). A sale lowers stock through the recipes.
import { z } from "zod";
import { signalAfter } from "@/lib/live/signal";
import { loadMenu, saveReceipt } from "@/lib/sales/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { todayLocal } from "@/lib/inventory/service";
import { resolveOne } from "../resolve";
import { ask, capped, changed, json, round2, defineTool } from "../types";

// HH:MM in the restaurant's time zone
function nowTime() {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const salesTools = [
  defineTool({
    name: "list_sales_receipts",
    tier: "read",
    area: "sales",
    description: "Customer receipts added to sales recently (scanned or entered), newest first.",
    input: z.object({}),
    run: async (_input, ctx) => {
      const res = await ctx.db.from("sales_receipts").select("id, order_id, receipt_number, receipt_date, total, source, created_at").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(31);
      if (res.error) return `Error: Could not load receipts: ${res.error.message}`;
      return json(capped(res.data ?? []));
    },
  }),
  defineTool({
    name: "record_sale",
    tier: "record",
    area: "sales",
    description: "Add a sale to today's sales by dish name. Prices come from the menu unless the owner says one. qty: whole dishes. channel: dine_in (default) or takeout.",
    input: z.object({
      dishes: z.array(z.object({ dish: z.string(), qty: z.number().int().min(1).max(100), price: z.number().min(0).optional() })).min(1).max(30),
      channel: z.enum(["dine_in", "takeout"]).optional(),
      tip: z.number().min(0).optional(),
    }),
    run: async ({ dishes, channel, tip }, ctx) => {
      const menu = await loadMenu(ctx.db);
      const asks: string[] = [];
      const lines: { menu_item_id: number; qty: number; unit_price: number; name: string }[] = [];
      for (const d of dishes) {
        const found = resolveOne(menu, d.dish, (m) => m.name, "dish");
        if (!found.ok) asks.push(found.ask);
        else lines.push({ menu_item_id: found.item.id, qty: d.qty, unit_price: d.price ?? found.item.price, name: found.item.name });
      }
      if (asks.length) return ask(asks.join(" "));
      const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
      const result = await saveReceipt(
        ctx.db,
        { receipt_number: "", date: todayLocal(), time: nowTime(), channel: channel ?? "dine_in", lines: lines.map(({ menu_item_id, qty, unit_price }) => ({ menu_item_id, qty, unit_price })), tax: 0, tip: tip ?? 0, total: round2(subtotal + (tip ?? 0)) },
        "manual",
      );
      signalAfter("/api/sales/receipts");
      return changed(ctx, {
        kind: "sale",
        label: `Sale added: ${lines.map((l) => `${l.qty} x ${l.name}`).join(", ")} ($${subtotal.toFixed(2)})`,
        before: null,
        after: subtotal,
      }, { now_low: result.alerts.map((a) => a.name) });
    },
  }),
];
