// Purchase orders: read the open ones, and draft new ones (draft_restock, and the order plan as on
// /api/orders/plan/draft). Drafts wait for the owner; nothing here approves or sends an order.
import { z } from "zod";
import { signalAfter } from "@/lib/live/signal";
import { parsePlanRequest } from "@/lib/purchasing/planHttp";
import { draftPlan } from "@/lib/purchasing/planService";
import { draftRestock } from "@/lib/purchasing/restock";
import { loadOrders, orderFromFlag } from "@/lib/purchasing/service";
import { loadMoney } from "@/lib/bank/cashPlan";
import { loadInventory, todayLocal } from "@/lib/inventory/service";
import { reorderQty } from "@/lib/inventory/stock";
import { planOrders } from "@/lib/purchasing/plan";
import { loadSources } from "@/lib/purchasing/sources";
import { recentLessons } from "@/lib/loop/store";
import { loadDishes, loadDishSales, loadRecipes } from "../evidence";
import { forecastIngredientUse, restockOptions } from "../investigate";
import { RESTAURANT_ID } from "@/lib/supabase";
import { dayToDate } from "./prep";
import { resolveOne } from "../resolve";
import { ask, capped, changed, json, defineTool, type AgentCtx } from "../types";

// The order that covers one ingredient for the next week: the larger of par minus on hand and the
// 7-day forecast minus on hand, from the cheapest supplier that can deliver (planOrders).
async function weekPlan(ctx: AgentCtx, ingredient: string) {
  const today = todayLocal();
  const [inventory, sales, dishes, recipes, money, lessons] = await Promise.all([
    loadInventory(ctx.db),
    loadDishSales(ctx.db, 56),
    loadDishes(ctx.db),
    loadRecipes(ctx.db),
    loadMoney(ctx.db).catch(() => null),
    recentLessons(ctx.db, "stockout_risk", 10),
  ]);
  const found = resolveOne(inventory.lines, ingredient, (l) => l.name, "ingredient");
  if (!found.ok) return found;
  const line = found.item;
  const forecast = forecastIngredientUse(sales, dishes, recipes, line.id, today);
  const qty = Math.round(Math.max(reorderQty(line), forecast.total - line.estimated, 0) * 10) / 10;
  const { offers, suppliers, preferred } = await loadSources(ctx.db, today);
  const plan = planOrders(qty > 0 ? [{ ingredient_id: line.id, name: line.name, unit: line.unit, qty, note: `${qty} ${line.unit} for the next 7 days` }] : [], offers, suppliers, preferred, null);
  return { ok: true as const, line, forecast, plan, qty, money, lessons };
}

export const purchasingTools = [
  defineTool({
    name: "restock_options",
    tier: "read",
    area: "purchasing",
    description:
      "For one ingredient: stock and days left, the next 7 days' use from the dish forecast, how much to order and why, each supplier's packs, cost, " +
      "delivery date and order minimum, and the cash left after the order. Read only: use before drafting an order.",
    input: z.object({ ingredient: z.string() }),
    run: async ({ ingredient }, ctx) => {
      const w = await weekPlan(ctx, ingredient);
      if (!w.ok) return ask(w.ask);
      const last = w.lessons.find((l) => l.item.trim().toLowerCase() === w.line.name.trim().toLowerCase());
      return json({
        ...restockOptions({ line: w.line, forecast: w.forecast, plan: w.plan, cash: w.money ? { start: w.money.forecast.start, reserve: w.money.forecast.reserve, lowest: w.money.forecast.lowest } : null }),
        last_time: last ? `${last.action}, ${last.verdict}` : undefined,
      });
    },
  }),
  defineTool({
    name: "draft_restock_for_week",
    tier: "draft",
    area: "purchasing",
    description:
      "Draft the purchase order restock_options recommends for one ingredient: enough for the next 7 days' forecast (or up to par, whichever is more), " +
      "from the best supplier. Only a draft: the owner approves it. Prefer this over draft_restock when something runs out before a delivery.",
    input: z.object({ ingredient: z.string() }),
    run: async ({ ingredient }, ctx) => {
      const w = await weekPlan(ctx, ingredient);
      if (!w.ok) return ask(w.ask);
      const group = w.plan.groups[0];
      if (!group) return json({ ok: true, drafted: false, note: w.qty > 0 ? `No supplier has a price for ${w.line.name}.` : `${w.line.name} doesn't need ordering.` });
      const l = group.lines[0];
      const po = await ctx.db
        .from("purchase_orders")
        .insert({
          restaurant_id: RESTAURANT_ID, supplier_id: group.supplier_id, status: "draft", created_by: "ai",
          reason: `${w.line.name}: ${l.note}. ${l.choice.packs} x ${l.choice.pack_desc ?? "pack"}.${group.below_minimum > 0 ? ` $${group.below_minimum.toFixed(2)} under their $${group.min_order_amount.toFixed(2)} minimum.` : ""}`,
        })
        .select("id")
        .single();
      if (po.error) return `Error: ${po.error.message}`;
      const id = (po.data as { id: number }).id;
      const lineRes = await ctx.db.from("purchase_order_lines").insert({ purchase_order_id: id, ingredient_id: w.line.id, qty: l.choice.packs, est_unit_price: l.choice.cost / l.choice.packs });
      if (lineRes.error) return `Error: ${lineRes.error.message}`;
      signalAfter("/api/orders/plan/draft");
      return changed(
        ctx,
        { kind: "order_drafted", label: `Draft order #${id} to ${group.supplier}: ${l.choice.packs} x ${l.choice.pack_desc ?? w.line.name}, $${group.total.toFixed(2)}, covers the next 7 days (waiting for your OK)`, before: null, after: id },
        { order_id: id, packs: l.choice.packs, total: group.total, arrives: group.arrives, below_minimum: group.below_minimum },
      );
    },
  }),
  defineTool({
    name: "order_for_invoice_flag",
    tier: "draft",
    area: "purchasing",
    description: "Draft a purchase order from a cheaper-supplier flag on an invoice (flag_id from get_invoice or profit_opportunities), the same as the invoice page's button. Only a draft: the owner approves it.",
    input: z.object({ flag_id: z.number().int().positive() }),
    run: async ({ flag_id }, ctx) => {
      const orderId = await orderFromFlag(ctx.db, flag_id);
      signalAfter("/api/invoice-flags/[id]/order");
      return changed(ctx, { kind: "order_drafted", label: `Draft order #${orderId} from the cheaper supplier (waiting for your OK)`, before: null, after: orderId }, { order_id: orderId });
    },
  }),
  defineTool({
    name: "list_purchase_orders",
    tier: "read",
    area: "purchasing",
    description: "Open purchase orders (draft = waiting for the owner's OK, approved = not sent yet, sent = on the way), with supplier, total and delivery date.",
    input: z.object({ status: z.enum(["draft", "approved", "sent", "all"]).optional() }),
    run: async ({ status }, ctx) => {
      const orders = (await loadOrders(ctx.db)).filter((o) => !status || status === "all" || o.status === status);
      return json(capped(orders.map((o) => ({ id: o.id, status: o.status, supplier: o.supplier, total: o.total, items: o.lines.length, delivery_date: o.delivery_date, below_minimum: o.below_minimum }))));
    },
  }),
  defineTool({
    name: "get_purchase_order",
    tier: "read",
    area: "purchasing",
    description: "One purchase order in full: lines, total, minimum, delivery date and the message to send. order: its number, or the supplier's name.",
    input: z.object({ order: z.string() }),
    run: async ({ order }, ctx) => {
      const orders = await loadOrders(ctx.db);
      const id = Number(order.replace(/^#|^po\s*#?/i, "").trim());
      let found = Number.isInteger(id) && id > 0 ? orders.find((o) => o.id === id) : undefined;
      if (!found && Number.isInteger(id) && id > 0) {
        // Not open any more: the basics from the table
        const res = await ctx.db.from("purchase_orders").select("id, status, created_at, sent_at, suppliers(name)").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
        return res.data ? json(res.data) : ask(`I couldn't find purchase order #${id}. Which order did you mean?`);
      }
      if (!found) {
        // By supplier: one of their open orders, or ask which (by number, since the names are the same)
        const supplier = resolveOne([...new Set(orders.map((o) => o.supplier))], order, (name) => name, "supplier with an open order");
        if (!supplier.ok) return ask(supplier.ask);
        const theirs = orders.filter((o) => o.supplier === supplier.item);
        if (theirs.length > 1) return ask(`Which ${supplier.item} order: ${theirs.map((o) => `#${o.id} (${o.status}, $${o.total.toFixed(2)})`).join(" or ")}?`);
        found = theirs[0];
      }
      const { contact, ...rest } = found;
      return json({ ...rest, contact: contact.label });
    },
  }),
  defineTool({
    name: "draft_restock",
    tier: "draft",
    area: "purchasing",
    description: "Draft one purchase order for a low ingredient. Does not approve or send it. Pass the food name the owner said.",
    input: z.object({ ingredient: z.string() }),
    run: async ({ ingredient }, ctx) => {
      const result = await draftRestock(ctx.db, ingredient);
      if (!result.drafted) return json(result);
      ctx.order = result;
      signalAfter("/api/orders/plan/draft");
      return changed(ctx, { kind: "order_drafted", label: `Draft order #${result.orderId} to ${result.supplier}, $${result.total.toFixed(2)} (waiting for your OK)`, before: null, after: result.orderId }, { order: result });
    },
  }),
  defineTool({
    name: "draft_order_plan",
    tier: "draft",
    area: "purchasing",
    description:
      "Draft purchase orders from the order plan, one per supplier, waiting for the owner's OK on Invoices. kind 'low': everything below its reorder point. " +
      "kind 'prep': what a coming day's prep would run short of (day: tomorrow up to a week ahead).",
    input: z.object({ kind: z.enum(["low", "prep"]), day: z.string().optional() }),
    run: async ({ kind, day }, ctx) => {
      const req = parsePlanRequest(kind === "low" ? { kind } : { kind, date: dayToDate(day ?? "tomorrow") });
      if (!req) return "Error: Say what to plan: low stock, or a prep day in the next week.";
      const created = await draftPlan(ctx.db, req);
      if (!created.length) return json({ ok: true, drafted: 0, note: "Nothing needs ordering." });
      signalAfter("/api/orders/plan/draft");
      return changed(ctx, {
        kind: "orders_drafted",
        label: `Drafted ${created.length} order${created.length === 1 ? "" : "s"} (${created.map((id) => `#${id}`).join(", ")}), waiting for your OK`,
        before: null,
        after: created.length,
      }, { order_ids: created });
    },
  }),
];
