// What each Commit action does once the owner approves it (server only). Every executor loads
// the current state again, re-checks its limits (lib/agent/limits.ts), calls the same service
// its page's route calls, and signals live updates the way that route does. Nothing here is
// reachable by the model: tools can only propose (lib/agent/actions.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { markBillPaid } from "@/lib/accounting/service";
import { moveToSavings } from "@/lib/bank/cashPlan";
import { setReserve } from "@/lib/bank/service";
import { applyAction, decideCall, supabaseStore } from "@/lib/calls/service";
import { BriefSchema } from "@/lib/calls/types";
import { signalAfter, syncCallsAfter } from "@/lib/live/signal";
import type { PostEdit } from "@/lib/marketing/edit";
import { publishPost } from "@/lib/marketing/publish";
import { applyDeliveryPrices, changePrice, loadPricing, markUpdated, SYSTEMS, type System } from "@/lib/pricing/service";
import { mailtoLink } from "@/lib/purchasing/disputes";
import { markSent } from "@/lib/purchasing/disputeService";
import { loadOrders, setOrderStatus } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { createWajo } from "@/lib/wajo/client";
import type { ActionRow, Executor } from "./actions";
import { checkDiscount, checkMenuPrice, checkMoneyMove, checkPurchaseOrder, checkReserve, type LimitCheck } from "./limits";

export class LimitError extends Error {}

// Wajo couldn't start an approved call: the action fails, and the page still gets the call row.
export class CallStartFailed extends Error {
  call: unknown;
  constructor(message: string, call: unknown) {
    super(message);
    this.call = call;
  }
}

function enforce(check: LimitCheck) {
  if (!check.ok) throw new LimitError(check.reason);
}

const num = (row: ActionRow, key: string) => {
  const v = Number(row.args[key]);
  if (!Number.isFinite(v)) throw new Error(`The action is missing ${key}.`);
  return v;
};
const str = (row: ActionRow, key: string) => (typeof row.args[key] === "string" ? (row.args[key] as string) : "");

async function openOrder(db: SupabaseClient, id: number, status: "draft" | "approved") {
  const order = (await loadOrders(db)).find((o) => o.id === id);
  if (!order) throw new Error(`Purchase order #${id} isn't open any more.`);
  if (order.status !== status) throw new Error(`Purchase order #${id} is ${order.status} now, not ${status}.`);
  return order;
}

export function executorsFor(db: SupabaseClient): Record<string, Executor> {
  return {
    async approve_purchase_order(row) {
      const id = num(row, "order_id");
      const order = await openOrder(db, id, "draft");
      enforce(checkPurchaseOrder(order.total, row.source));
      await setOrderStatus(db, id, "approved");
      signalAfter("/api/purchase-orders/[id]/status");
      return { order_id: id, supplier: order.supplier, total: order.total, href: "/invoices/orders" };
    },

    // The message goes out from the owner's phone or email (the card opens or copies it);
    // this records the order as sent, as the Invoices page does.
    async send_purchase_order(row) {
      const id = num(row, "order_id");
      const order = await openOrder(db, id, "approved");
      enforce(checkPurchaseOrder(order.total, row.source));
      await setOrderStatus(db, id, "sent");
      signalAfter("/api/purchase-orders/[id]/status");
      return { order_id: id, supplier: order.supplier, total: order.total, message: order.message, contact: order.contact, href: "/invoices/orders" };
    },

    async mark_invoice_paid(row) {
      const id = num(row, "invoice_id");
      await markBillPaid(db, id);
      signalAfter("/api/invoices/[id]/paid");
      return { invoice_id: id, href: `/invoices/${id}` };
    },

    async set_menu_price(row) {
      const id = num(row, "menu_item_id");
      const newPrice = num(row, "new_price");
      const dish = await db.from("menu_items").select("name, price").eq("id", id).eq("restaurant_id", RESTAURANT_ID).maybeSingle();
      if (dish.error || !dish.data) throw new Error("That dish isn't on the menu.");
      enforce(checkMenuPrice(Number(dish.data.price), newPrice, row.source));
      await changePrice(db, id, newPrice, str(row, "reason"));
      signalAfter("/api/menu-items/[id]/price");
      return { menu_item_id: id, dish: dish.data.name, old_price: Number(dish.data.price), new_price: newPrice, href: "/menu" };
    },

    // Raises the delivery-app prices that are too low. Worked out again now: if the list changed
    // since the proposal, nothing is applied.
    async set_delivery_prices(row) {
      const { delivery } = await loadPricing(db);
      const now = delivery.prices.map((p) => `${p.menu_item_id}:${p.new_delivery_price}`).sort().join(",");
      const proposed = Array.isArray(row.args.prices) ? (row.args.prices as { menu_item_id: number; new_delivery_price: number }[]).map((p) => `${p.menu_item_id}:${p.new_delivery_price}`).sort().join(",") : now;
      if (row.source !== "owner" && now !== proposed) throw new LimitError("The delivery prices changed since this was proposed. Ask again for a fresh proposal.");
      const changed = await applyDeliveryPrices(db);
      signalAfter("/api/menu/delivery-prices");
      return { changed, href: "/menu" };
    },

    async mark_delivery_price_updated(row) {
      const id = num(row, "change_id");
      const system = str(row, "system");
      if (!Object.hasOwn(SYSTEMS, system)) throw new Error("system must be pos, doordash or ubereats.");
      await markUpdated(db, id, system as System);
      signalAfter("/api/price-changes/[id]/updated");
      return { change_id: id, system, href: "/menu/changes" };
    },

    // Approving dials through Wajo. The number always comes from suppliers.phone or the demo
    // override (lib/calls/phone.ts), never from the action.
    async place_call(row) {
      const id = num(row, "call_id");
      const brief = row.args.brief ? BriefSchema.parse(row.args.brief) : undefined;
      const call = await decideCall(supabaseStore(db), createWajo(), id, { approve: true, brief });
      syncCallsAfter(db, [id], "/api/calls/[id]/decide");
      if (call.status === "failed") throw new CallStartFailed(call.error ?? "The call couldn't start.", call);
      return { call_id: id, status: call.status, dialed: call.dialed_number, href: "/suppliers/calls" };
    },

    async reject_call(row) {
      const id = num(row, "call_id");
      const call = await decideCall(supabaseStore(db), createWajo(), id, { approve: false });
      syncCallsAfter(db, [id], "/api/calls/[id]/decide");
      return { call_id: id, status: call.status };
    },

    async apply_call_result(row) {
      const id = num(row, "call_id");
      const action = str(row, "action");
      await applyAction(db, id, action);
      syncCallsAfter(db, [id], "/api/calls/[id]/apply");
      return { call_id: id, action };
    },

    // The email goes from the owner's mail app (the card opens it); this records it as sent.
    async send_dispute(row) {
      const id = num(row, "dispute_id");
      const edits = { to_email: str(row, "to_email"), subject: str(row, "subject"), body: str(row, "body") };
      await markSent(db, id, edits, row.args.save_email === true);
      signalAfter("/api/disputes/[id]");
      return { dispute_id: id, mailto: edits.to_email ? mailtoLink(edits.to_email, edits.subject, edits.body) : null, href: row.args.invoice_id ? `/invoices/${row.args.invoice_id}` : "/invoices" };
    },

    // A promotion: the discount is checked again against today's cost, then the post goes out.
    // The POS can't be changed from here, so the price step comes back as a checklist item.
    async start_promotion(row) {
      const id = num(row, "post_id");
      const dishId = num(row, "menu_item_id");
      const discount = Number(row.args.discount_usd ?? 0);
      if (discount > 0) {
        const s = (await loadPricing(db)).suggestions.find((x) => x.dish.id === dishId);
        if (!s) throw new LimitError("The dish's food cost is unknown, so the discount can't be checked.");
        enforce(checkDiscount(discount, s.dish.price, s.cost_now));
      }
      const published = await publishPost(db, id);
      return { ...published, checklist: row.args.pos_step ? [row.args.pos_step] : [], href: "/marketing" };
    },

    async publish_post(row) {
      const id = num(row, "post_id");
      const result = await publishPost(db, id, row.args.edit as PostEdit | undefined);
      return { ...result, href: "/marketing" };
    },

    async bank_reserve(row) {
      const amount = num(row, "amount");
      enforce(checkReserve(amount));
      await setReserve(db, amount);
      return { reserve: amount, simulated: true, href: "/accounting" };
    },

    async bank_savings(row) {
      const amount = num(row, "amount");
      enforce(checkMoneyMove(amount));
      await moveToSavings(db, amount);
      return { moved: amount, simulated: true, href: "/accounting" };
    },
  };
}

// The tools that can be proposed (the executors' names), for checks and tests.
export const COMMIT_TOOLS = Object.keys(executorsFor({} as SupabaseClient));
