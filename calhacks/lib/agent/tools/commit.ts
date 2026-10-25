// Commit actions: anything that spends money, changes a price, contacts someone outside the
// restaurant or moves money. Each tool here only resolves what the owner means (in code), checks
// the limits early, and records a proposal (lib/agent/actions.ts). Nothing runs until the owner
// taps Approve on the card; the executor (lib/agent/executors.ts) re-checks everything then.
// The tools sit in one file (unlike the area files) so no Commit tool can accidentally act.
import { z } from "zod";
import { loadAccounting } from "@/lib/accounting/service";
import { loadInventory, todayLocal } from "@/lib/inventory/service";
import { listCalls } from "@/lib/calls/service";
import { dialTarget, formatPhone } from "@/lib/calls/phone";
import { suggestedActions } from "@/lib/calls/types";
import { loadPricing, SYSTEMS } from "@/lib/pricing/service";
import { latestDispute } from "@/lib/purchasing/disputeService";
import { loadOrders } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import { ActionTableMissing, propose, supabaseActions, type Evidence, type Impact } from "../actions";
import { loadDishes, loadDishSales, loadRecipes } from "../evidence";
import { COMMIT_TOOLS } from "../executors";
import { ASSUMED_PROMO_LIFT, dishStockUnits, forecastDishWeek } from "../investigate";
import { checkDiscount, checkMenuPrice, checkMoneyMove, checkPublish, checkPurchaseOrder } from "../limits";
import { resolveInvoice, resolveOne } from "../resolve";
import { ask, defineTool, json, round2, type AgentCtx, type Area } from "../types";

const money = (n: number) => `$${n.toFixed(2)}`;
// propose() only needs to know which tools have executors; the executors themselves stay server side.
const KNOWN = Object.fromEntries(COMMIT_TOOLS.map((t) => [t, async () => ({})]));

async function proposeAction(
  ctx: AgentCtx,
  tool: string,
  p: { title: string; summary: string; args: Record<string, unknown>; evidence?: Evidence; impact?: Impact | null },
  facts?: Record<string, unknown>, // kept on the loop's case for measuring (the promoted dish, the discount)
) {
  // From the loop: the case's weekly dollars and evidence travel with the proposal
  if (ctx.loop) {
    p = {
      ...p,
      impact: p.impact ?? ctx.loop.impact ?? null,
      evidence: [...(p.evidence ?? []), ...(ctx.loop.evidence ?? [])].slice(0, 8),
    };
  }
  try {
    const row = await propose(supabaseActions(ctx.db), { tool, ...p, source: ctx.surface === "loop" ? "loop" : "agent", surface: ctx.surface, case_id: ctx.loop?.caseId ?? null }, KNOWN);
    ctx.proposals.push({ action_id: row.id, tool, title: row.title, summary: row.summary });
    return json({ ok: true, proposed: { action_id: row.id, title: row.title, summary: row.summary }, facts, note: "Waiting for the owner to tap Approve on the card. Nothing has happened yet." });
  } catch (err) {
    if (err instanceof ActionTableMissing) return `Error: approvals aren't set up yet (supabase/18_agent_actions.sql hasn't been run), so this can't be proposed. The owner can do it on its page.`;
    throw err;
  }
}

const commit = (area: Area) => ({ tier: "commit" as const, area });

// What the caller may agree to, in words (0 means it doesn't apply).
export function limitsText(l: { min_credit: number; max_packs: number; max_total: number; notes: string }): string {
  const parts = [
    l.min_credit > 0 ? `accept a credit of at least ${money(l.min_credit)}` : "",
    l.max_packs > 0 ? `order up to ${l.max_packs} packs` : "",
    l.max_total > 0 ? `spend up to ${money(l.max_total)}` : "",
  ].filter(Boolean);
  const may = parts.length ? `It may ${parts.join(", ")}.` : "It can't agree to buy or pay anything.";
  return l.notes.trim() ? `${may} ${l.notes.trim().replace(/[.\s]*$/, ".")}` : may;
}

async function findOrder(ctx: AgentCtx, query: string, status: "draft" | "approved") {
  const orders = (await loadOrders(ctx.db)).filter((o) => o.status === status);
  const id = Number(query.replace(/^#|^po\s*#?/i, "").trim());
  if (Number.isInteger(id) && id > 0) {
    const byId = orders.find((o) => o.id === id);
    return byId ? { ok: true as const, item: byId } : { ok: false as const, ask: `Purchase order #${id} isn't ${status === "draft" ? "a draft" : "approved"}. Which order did you mean?` };
  }
  const supplier = resolveOne([...new Set(orders.map((o) => o.supplier))], query, (n) => n, `supplier with a${status === "approved" ? "n approved" : " draft"} order`);
  if (!supplier.ok) return supplier;
  const theirs = orders.filter((o) => o.supplier === supplier.item);
  if (theirs.length > 1) return { ok: false as const, ask: `Which ${supplier.item} order: ${theirs.map((o) => `#${o.id} (${money(o.total)})`).join(" or ")}?` };
  return { ok: true as const, item: theirs[0] };
}

async function findCall(ctx: AgentCtx, query: string, statuses: string[]) {
  const calls = (await listCalls(ctx.db, {})).filter((c) => statuses.includes(c.status));
  const id = Number(query.replace(/^#/, "").trim());
  if (Number.isInteger(id) && id > 0) {
    const byId = calls.find((c) => c.id === id);
    return byId ? { ok: true as const, item: byId } : { ok: false as const, ask: `Call request #${id} isn't ${statuses.join(" or ")}. Which call did you mean?` };
  }
  return resolveOne(calls, query, (c) => `${c.supplier.name} ${c.title}`, "call request");
}

export const commitTools = [
  defineTool({
    name: "approve_purchase_order",
    ...commit("purchasing"),
    description: "Propose approving a draft purchase order (order: its number or the supplier). The owner approves it on a card. Orders over $1,500 can't be approved here.",
    input: z.object({ order: z.string() }),
    run: async ({ order }, ctx) => {
      const found = await findOrder(ctx, order, "draft");
      if (!found.ok) return ask(found.ask);
      const o = found.item;
      const limit = checkPurchaseOrder(o.total);
      if (!limit.ok) return `Error: ${limit.reason}`;
      return proposeAction(ctx, "approve_purchase_order", {
        title: `Approve order #${o.id} to ${o.supplier}, ${money(o.total)}`,
        summary: `Approve purchase order #${o.id} to ${o.supplier}: ${o.lines.length} item${o.lines.length === 1 ? "" : "s"}, ${money(o.total)}, delivery ${o.delivery_date}. It is not sent yet.`,
        args: { order_id: o.id },
        evidence: [{ label: "Lines", value: o.lines.map((l) => `${l.ingredient} x${l.qty}`).join(", "), href: "/invoices/orders" }, ...(o.below_minimum > 0 ? [{ label: "Below minimum by", value: money(o.below_minimum) }] : [])],
        impact: { amount_usd: o.total, per: "once", basis: "The order total (money that will be spent)." },
      });
    },
  }),
  defineTool({
    name: "send_purchase_order",
    ...commit("purchasing"),
    description: "Propose sending an approved purchase order to its supplier. On approval the card opens or copies the order message for the owner to send, and the order is recorded as sent.",
    input: z.object({ order: z.string() }),
    run: async ({ order }, ctx) => {
      const found = await findOrder(ctx, order, "approved");
      if (!found.ok) return ask(found.ask);
      const o = found.item;
      const limit = checkPurchaseOrder(o.total);
      if (!limit.ok) return `Error: ${limit.reason}`;
      return proposeAction(ctx, "send_purchase_order", {
        title: `Send order #${o.id} to ${o.supplier}`,
        summary: `Send purchase order #${o.id} (${money(o.total)}) to ${o.supplier} by ${o.contact.label}, and record it as sent.`,
        args: { order_id: o.id },
        evidence: [{ label: "Message", value: o.message.slice(0, 400) }],
        impact: { amount_usd: o.total, per: "once", basis: "The order total." },
      });
    },
  }),
  defineTool({
    name: "mark_invoice_paid",
    ...commit("invoices"),
    description: "Propose recording a supplier bill as paid (invoice: number, id or 'the latest Sysco invoice'). Only unpaid bills.",
    input: z.object({ invoice: z.string() }),
    run: async ({ invoice }, ctx) => {
      const { bills } = await loadAccounting(ctx.db);
      const unpaid = Object.values(bills).flat();
      const found = resolveInvoice(unpaid, invoice);
      if (!found.ok) return ask(found.ask);
      const b = found.item;
      return proposeAction(ctx, "mark_invoice_paid", {
        title: `Mark ${b.supplier} ${b.invoice_number ?? `#${b.id}`} paid, ${money(b.total)}`,
        summary: `Record ${b.supplier} invoice ${b.invoice_number ?? `#${b.id}`} (${money(b.total)}, due ${b.due_date}) as paid today.${b.disputed ? " It has an open dispute." : ""}`,
        args: { invoice_id: b.id },
        evidence: [{ label: "Due", value: b.due_date ?? "unknown", href: `/invoices/${b.id}` }],
        impact: { amount_usd: b.total, per: "once", basis: "The invoice total." },
      });
    },
  }),
  defineTool({
    name: "set_menu_price",
    ...commit("menu"),
    description: "Propose a new in-house menu price for one dish. Leave new_price out to use the Menu page's suggestion. At most 10% at a time.",
    input: z.object({ dish: z.string(), new_price: z.number().positive().optional() }),
    run: async ({ dish, new_price }, ctx) => {
      const pricing = await loadPricing(ctx.db, ctx.days);
      const found = resolveOne(pricing.suggestions, dish, (s) => s.dish.name, "dish");
      if (!found.ok) return ask(found.ask);
      const s = found.item;
      const price = new_price ?? s.new_price;
      if (price === null || price === undefined) return ask(`The Menu page doesn't suggest a new price for ${s.dish.name} (${money(s.dish.price)} now). What price?`);
      const limit = checkMenuPrice(s.dish.price, price, "agent");
      if (!limit.ok) return `Error: ${limit.reason}`;
      const weekly = round2(((price - s.dish.price) * s.dish.units * 7) / ctx.days);
      return proposeAction(ctx, "set_menu_price", {
        title: `${s.dish.name}: ${money(s.dish.price)} to ${money(price)}`,
        summary: `Change the in-house price of ${s.dish.name} from ${money(s.dish.price)} to ${money(price)}. Update the POS and the delivery apps after; the Menu page tracks that.`,
        args: { menu_item_id: s.dish.id, new_price: price, reason: s.reasons.join(" ").slice(0, 400) || "Proposed by the assistant" },
        evidence: [
          { label: "Cost to make", value: `${money(s.cost_before)} to ${money(s.cost_now)}` },
          { label: "Food cost", value: `${s.food_cost_pct}%` },
          { label: `Sold in the last ${ctx.days} days`, value: String(s.dish.units), href: "/menu" },
        ],
        impact: { amount_usd: weekly, per: "week", basis: `(${money(price)} - ${money(s.dish.price)}) x ${s.dish.units} sold in the last ${ctx.days} days, per week.`, assumptions: ["The same number sell at the new price."] },
      });
    },
  }),
  defineTool({
    name: "set_delivery_prices",
    ...commit("menu"),
    description: "Propose raising every delivery-app price that's too low after the apps' commission to its suggested price (the Menu page's list).",
    input: z.object({}),
    run: async (_input, ctx) => {
      const { delivery } = await loadPricing(ctx.db, ctx.days);
      if (!delivery.prices.length) return json({ ok: true, note: "Every delivery-app price is fine already. Nothing to propose." });
      return proposeAction(ctx, "set_delivery_prices", {
        title: `Raise ${delivery.prices.length} delivery-app price${delivery.prices.length === 1 ? "" : "s"}`,
        summary: `Set ${delivery.prices.map((p) => `${p.name} ${money(p.delivery_price)} to ${money(p.new_delivery_price)}`).join(", ")} on the delivery menu. Update DoorDash and Uber Eats after.`,
        args: { prices: delivery.prices.map((p) => ({ menu_item_id: p.menu_item_id, new_delivery_price: p.new_delivery_price })) },
        evidence: [{ label: "Apps keep", value: `${delivery.fee_pct}% of each order`, href: "/menu" }],
        impact: { amount_usd: round2((delivery.extra_profit * 7) / ctx.days), per: "week", basis: `The gap to the suggested prices x app sales in the last ${ctx.days} days, per week.`, assumptions: ["The same number sell on the apps."] },
      });
    },
  }),
  defineTool({
    name: "mark_delivery_price_updated",
    ...commit("menu"),
    description: `Propose recording that a price change was made in another system (${Object.keys(SYSTEMS).join(", ")}) for a dish.`,
    input: z.object({ dish: z.string(), system: z.enum(Object.keys(SYSTEMS) as [keyof typeof SYSTEMS, ...(keyof typeof SYSTEMS)[]]) }),
    run: async ({ dish, system }, ctx) => {
      const { changes } = await loadPricing(ctx.db, ctx.days);
      const pending = changes.filter((c) => !c[`${system}_updated`]);
      const found = resolveOne(pending, dish, (c) => c.menu_items?.name ?? "", `price change not yet in ${SYSTEMS[system]}`);
      if (!found.ok) return ask(found.ask);
      const c = found.item;
      return proposeAction(ctx, "mark_delivery_price_updated", {
        title: `${c.menu_items?.name}: updated in ${SYSTEMS[system]}`,
        summary: `Record that ${c.menu_items?.name}'s price change (${money(c.old_price)} to ${money(c.new_price)}) was made in ${SYSTEMS[system]}.`,
        args: { change_id: c.id, system },
      });
    },
  }),
  defineTool({
    name: "place_call",
    ...commit("calls"),
    description: "Propose placing a pending supplier call request (call: its number, or the supplier and topic). On approval Wajo dials the number on file, which the card shows.",
    input: z.object({ call: z.string() }),
    run: async ({ call }, ctx) => {
      const found = await findCall(ctx, call, ["pending"]);
      if (!found.ok) return ask(found.ask);
      const c = found.item;
      const target = dialTarget(c.supplier.phone);
      if (!target) return `Error: ${c.supplier.name} has no usable phone number on file.`;
      const shown = target.override ? `${formatPhone(target.dial)} (demo phone, instead of ${formatPhone(target.supplier_number)})` : formatPhone(target.dial);
      return proposeAction(ctx, "place_call", {
        title: `Call ${c.supplier.name}: ${c.title}`,
        summary: `An AI caller phones ${c.supplier.name} at ${shown}. Goal: ${c.brief.goal.replace(/[.\s]+$/, "")}. ${limitsText(c.brief.limits)}`,
        args: { call_id: c.id },
        evidence: [{ label: "Why", value: c.reason ?? c.title, href: "/suppliers/calls" }],
      });
    },
  }),
  defineTool({
    name: "reject_call",
    ...commit("calls"),
    description: "Propose turning down a pending supplier call request.",
    input: z.object({ call: z.string() }),
    run: async ({ call }, ctx) => {
      const found = await findCall(ctx, call, ["pending"]);
      if (!found.ok) return ask(found.ask);
      return proposeAction(ctx, "reject_call", { title: `Don't call ${found.item.supplier.name}: ${found.item.title}`, summary: `Turn down call request #${found.item.id}. Nobody is called.`, args: { call_id: found.item.id } });
    },
  }),
  defineTool({
    name: "apply_call_result",
    ...commit("calls"),
    description: "Propose applying what a finished supplier call agreed (a new price, a credit, a confirmed order). action: the result to apply, as get_call shows it.",
    input: z.object({ call: z.string(), action: z.string() }),
    run: async ({ call, action }, ctx) => {
      const found = await findCall(ctx, call, ["completed"]);
      if (!found.ok) return ask(found.ask);
      const choices = suggestedActions(found.item);
      if (!choices.length) return json({ ok: true, note: "This call has nothing left to apply." });
      const picked = resolveOne(choices, action, (a) => a.label, "result to apply");
      if (!picked.ok) return ask(picked.ask);
      return proposeAction(ctx, "apply_call_result", { title: `${found.item.supplier.name}: ${picked.item.label}`, summary: `${picked.item.label} (from call #${found.item.id}, "${found.item.title}").`, args: { call_id: found.item.id, action: picked.item.id } });
    },
  }),
  defineTool({
    name: "send_dispute",
    ...commit("invoices"),
    description: "Propose sending the saved dispute email for an invoice (save_dispute_draft first). On approval the card opens the email for the owner to send, and it's recorded as sent.",
    input: z.object({ invoice: z.string() }),
    run: async ({ invoice }, ctx) => {
      const res = await ctx.db.from("invoices").select("id, invoice_number, invoice_date, suppliers(name)").eq("restaurant_id", RESTAURANT_ID).order("invoice_date", { ascending: false }).limit(200);
      if (res.error) return `Error: ${res.error.message}`;
      const invoices = (res.data as unknown as { id: number; invoice_number: string | null; invoice_date: string; suppliers: { name: string } | null }[]).map((i) => ({ ...i, supplier: i.suppliers?.name ?? "Supplier" }));
      const found = resolveInvoice(invoices, invoice);
      if (!found.ok) return ask(found.ask);
      const dispute = await latestDispute(ctx.db, found.item.id);
      if (!dispute || dispute.status !== "draft") return `Error: there's no dispute draft for that invoice. Use save_dispute_draft first.`;
      if (!dispute.to_email || !dispute.body) return ask(`Who should the dispute go to? I need an email address for ${found.item.supplier}.`);
      return proposeAction(ctx, "send_dispute", {
        title: `Send dispute to ${found.item.supplier}, ${money(dispute.amount_claimed)}`,
        summary: `Email ${dispute.to_email} about invoice ${found.item.invoice_number ?? `#${found.item.id}`}, claiming ${money(dispute.amount_claimed)}. Subject: ${dispute.subject ?? ""}.`,
        args: { dispute_id: dispute.id, invoice_id: found.item.id, to_email: dispute.to_email, subject: dispute.subject ?? "", body: dispute.body },
        evidence: [{ label: "Email", value: dispute.body.slice(0, 400), href: `/invoices/${found.item.id}` }],
        impact: { amount_usd: dispute.amount_claimed, per: "once", basis: "The amount claimed back." },
      });
    },
  }),
  defineTool({
    name: "publish_post",
    ...commit("marketing"),
    description: "Propose publishing a drafted Instagram post (post: its number or dish). Needs the dish on the menu and stock for a promo week.",
    input: z.object({ post: z.string() }),
    run: async ({ post }, ctx) => {
      const res = await ctx.db.from("marketing_posts").select("id, dish_name, headline, caption, status").eq("restaurant_id", RESTAURANT_ID).in("status", ["draft", "failed"]).order("created_at", { ascending: false }).limit(30);
      if (res.error) return `Error: ${res.error.message}`;
      const drafts = res.data as { id: number; dish_name: string; headline: string; caption: string }[];
      const id = Number(post.replace(/^#/, ""));
      const found = Number.isInteger(id) && id > 0 ? (drafts.find((d) => d.id === id) ? { ok: true as const, item: drafts.find((d) => d.id === id)! } : { ok: false as const, ask: `Post #${id} isn't a draft. Which post?` }) : resolveOne(drafts, post, (d) => d.dish_name, "drafted post");
      if (!found.ok) return ask(found.ask);
      const d = found.item;
      const [dishes, recipes, inventory, sales] = await Promise.all([loadDishes(ctx.db), loadRecipes(ctx.db), loadInventory(ctx.db), loadDishSales(ctx.db, 56)]);
      const dish = dishes.find((x) => x.name.trim().toLowerCase() === d.dish_name.trim().toLowerCase()) ?? null;
      let covers: boolean | null = null;
      if (dish) {
        const canMake = dishStockUnits(recipes, new Map(inventory.lines.map((l) => [l.id, l.estimated]))).get(dish.id);
        const week = (forecastDishWeek(sales, dishes, todayLocal()).get(dish.id) ?? 0) * ASSUMED_PROMO_LIFT;
        covers = canMake === undefined ? null : canMake >= week;
      }
      const limit = checkPublish(dish ? { active: true } : null, covers);
      if (!limit.ok) return `Error: ${limit.reason}`;
      return proposeAction(ctx, "publish_post", {
        title: `Post to Instagram: ${d.headline}`,
        summary: `Publish post #${d.id} about ${d.dish_name} to Instagram through Buffer now. Caption: "${d.caption.slice(0, 160)}${d.caption.length > 160 ? "..." : ""}"`,
        args: { post_id: d.id },
        evidence: [{ label: "Stock covers a promo week", value: covers === null ? "unknown (not a menu dish)" : covers ? "yes" : "no", href: "/marketing" }],
      });
    },
  }),
  defineTool({
    name: "start_promotion",
    ...commit("marketing"),
    description:
      "Propose a whole promotion from a draft_campaign post: publish the post now, plus a checklist item to set the offer in the POS (the POS can't be " +
      "changed from here). post: the post id. Repeat the offer, discount and daypart you drafted with. days: how long it runs (default 14).",
    input: z.object({
      post: z.string(),
      offer: z.enum(["feature", "drink_bundle", "discount"]),
      discount_usd: z.number().min(0).max(2).optional(),
      daypart: z.enum(["lunch", "dinner"]).optional(),
      days: z.number().int().min(3).max(28).optional(),
    }),
    run: async ({ post, offer, discount_usd, daypart, days }, ctx) => {
      const id = Number(post.replace(/^#/, ""));
      const res = await ctx.db.from("marketing_posts").select("id, dish_name, headline, status").eq("restaurant_id", RESTAURANT_ID).eq("id", id).maybeSingle();
      if (res.error) return `Error: ${res.error.message}`;
      const p = res.data as { id: number; dish_name: string; headline: string; status: string } | null;
      if (!p || !["draft", "failed"].includes(p.status)) return ask(`Post #${post} isn't a draft. Which drafted post should the promotion use?`);
      const dishes = await loadDishes(ctx.db);
      const dish = dishes.find((d) => d.name.trim().toLowerCase() === p.dish_name.trim().toLowerCase());
      if (!dish) return `Error: ${p.dish_name} isn't an active dish on the menu.`;
      const discount = offer === "discount" ? (discount_usd ?? 0) : 0;
      const pricing = await loadPricing(ctx.db, ctx.days);
      const s = pricing.suggestions.find((x) => x.dish.id === dish.id);
      if (discount > 0) {
        if (!s) return "Error: the food cost for this dish is unknown, so a discount can't be checked.";
        const limit = checkDiscount(discount, dish.price, s.cost_now);
        if (!limit.ok) return `Error: ${limit.reason}`;
      }
      const runDays = days ?? 14;
      const until = new Date(Date.now() + runDays * 86400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
      const when = daypart ? ` at ${daypart}` : "";
      const pos = discount > 0 ? `Set ${money(discount)} off ${dish.name}${when} in your POS until ${until}.` : offer === "drink_bundle" ? `Ring up the ${dish.name} and drink bundle${when} in your POS until ${until}.` : null;
      return proposeAction(
        ctx,
        "start_promotion",
        {
          title: `Promote ${dish.name}${when}: ${offer === "discount" ? `${money(discount)} off` : offer === "drink_bundle" ? "drink bundle" : "feature"}`,
          summary: `Post #${p.id} ("${p.headline}") goes to Instagram now.${pos ? ` Then: ${pos}` : ""} Measured for ${runDays} days against the same weekdays before.`,
          args: { post_id: p.id, menu_item_id: dish.id, offer, discount_usd: discount, daypart: daypart ?? null, days: runDays, pos_step: pos },
          evidence: [{ label: "Post", value: p.headline, href: "/marketing" }, ...(s ? [{ label: "Food cost", value: `${s.food_cost_pct}%` }] : [])],
          impact: discount > 0 ? { amount_usd: null, per: "week", basis: `Costs ${money(discount)} a plate sold with the offer. No sales lift is assumed.`, assumptions: ["The measured result decides whether it worked."] } : null,
        },
        { promoted_dish_id: dish.id, promoted_dish: dish.name, offer, discount_usd: discount, daypart: daypart ?? null },
      );
    },
  }),
  defineTool({
    name: "bank_reserve",
    ...commit("analytics"),
    description: "Propose a new cash reserve for the bank account (the amount the cash plan keeps aside).",
    input: z.object({ amount: z.number().positive() }),
    run: async ({ amount }, ctx) => {
      const limit = checkMoneyMove(amount);
      if (!limit.ok) return `Error: ${limit.reason}`;
      return proposeAction(ctx, "bank_reserve", { title: `Set the cash reserve to ${money(amount)}`, summary: `Keep ${money(amount)} aside in the operating account; the cash plan warns below it.`, args: { amount } });
    },
  }),
  defineTool({
    name: "bank_savings",
    ...commit("analytics"),
    description: "Propose moving money from the operating account to savings. Check get_cash_plan first; it suggests a safe amount.",
    input: z.object({ amount: z.number().positive() }),
    run: async ({ amount }, ctx) => {
      const limit = checkMoneyMove(amount);
      if (!limit.ok) return `Error: ${limit.reason}`;
      return proposeAction(ctx, "bank_savings", { title: `Move ${money(amount)} to savings`, summary: `Move ${money(amount)} from the operating account to savings (Capital One Nessie accounts).`, args: { amount }, impact: { amount_usd: amount, per: "once", basis: "The amount moved." } });
    },
  }),
];
