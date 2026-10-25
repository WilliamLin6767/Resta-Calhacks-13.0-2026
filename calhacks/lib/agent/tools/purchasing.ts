// Purchase orders: read the open ones, and draft new ones (draft_restock, and the order plan as on
// /api/orders/plan/draft). Drafts wait for the owner; nothing here approves or sends an order.
import { z } from "zod";
import { signalAfter } from "@/lib/live/signal";
import { parsePlanRequest } from "@/lib/purchasing/planHttp";
import { draftPlan } from "@/lib/purchasing/planService";
import { draftRestock } from "@/lib/purchasing/restock";
import { loadOrders } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { dayToDate } from "./prep";
import { resolveOne } from "../resolve";
import { ask, capped, changed, json, defineTool } from "../types";

export const purchasingTools = [
  defineTool({
    name: "list_purchase_orders",
    description: "Open purchase orders (draft = waiting for the owner's OK, approved = not sent yet, sent = on the way), with supplier, total and delivery date.",
    input: z.object({ status: z.enum(["draft", "approved", "sent", "all"]).optional() }),
    run: async ({ status }, ctx) => {
      const orders = (await loadOrders(ctx.db)).filter((o) => !status || status === "all" || o.status === status);
      return json(capped(orders.map((o) => ({ id: o.id, status: o.status, supplier: o.supplier, total: o.total, items: o.lines.length, delivery_date: o.delivery_date, below_minimum: o.below_minimum }))));
    },
  }),
  defineTool({
    name: "get_purchase_order",
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
