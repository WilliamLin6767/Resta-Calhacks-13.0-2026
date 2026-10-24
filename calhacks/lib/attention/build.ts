// What needs the owner on each tab (server only). Plain code: each item comes straight from the
// numbers the tab already shows, with the buttons to act on it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { payoutDispute, PLATFORMS } from "@/lib/accounting/reconcile";
import { loadAccounting } from "@/lib/accounting/service";
import { loadInventory } from "@/lib/inventory/service";
import { countGap } from "@/lib/inventory/stock";
import { prepNeeds } from "@/lib/prep/forecast";
import { addDays, loadPrep, todayLocal } from "@/lib/prep/service";
import { loadPricing, SYSTEMS, type System } from "@/lib/pricing/service";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import { amountToPay } from "@/lib/purchasing/disputes";
import { loadOrders } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { Item, Tab, TabFacts } from "./types";

type Db = SupabaseClient;

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
function shortDate(date: string) {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type Built = { items: Item[]; facts: TabFacts };

// ---------- Inventory: what's running out, and restock orders to approve and send ----------
async function inventory(db: Db): Promise<Built> {
  const [{ lines, events, wasteWeek }, orders] = await Promise.all([loadInventory(db), loadOrders(db)]);
  const items: Item[] = [];
  const out = lines.filter((l) => l.status === "out");
  const low = lines.filter((l) => l.status === "low").sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99));

  for (const l of out) {
    items.push({
      key: `out:${l.id}`, fingerprint: "out", tab: "inventory", level: "act", dismissable: true,
      title: `Out of ${l.name}`, detail: `Uses about ${fmt(l.daily_use)} ${l.unit} a day.`,
      actions: [{ kind: "plan", label: "Plan a restock order", request: { kind: "low" } }],
    });
  }
  if (low.length) {
    items.push({
      key: "low", fingerprint: low.map((l) => l.id).join(","), tab: "inventory", dismissable: true,
      level: low.some((l) => (l.days_left ?? 99) < 1) ? "act" : "watch",
      title: `${low.length} ${low.length === 1 ? "item is" : "items are"} running low`,
      detail: low.slice(0, 5).map((l) => `${l.name} (${l.days_left === null ? `${fmt(l.estimated)} ${l.unit} left` : `about ${fmt(l.days_left)} ${l.days_left === 1 ? "day" : "days"}`})`).join(", ") + (low.length > 5 ? ", ..." : ""),
      actions: [{ kind: "plan", label: "Plan restock orders", request: { kind: "low" } }],
    });
  }
  for (const o of orders) {
    const list = o.lines.map((l) => `${l.qty} x ${l.ingredient}`).join(", ");
    if (o.status === "draft") {
      items.push({
        key: `order:${o.id}`, fingerprint: o.status, tab: "inventory", level: "act",
        title: `Approve restock order: ${o.supplier}, ${money(o.total)}`,
        detail: `${list}.${o.below_minimum > 0 ? ` ${money(o.below_minimum)} under their minimum.` : ""}`,
        actions: [
          { kind: "post", label: "Approve", path: `/api/purchase-orders/${o.id}/status`, body: { status: "approved" }, primary: true },
          { kind: "post", label: "Deny", path: `/api/purchase-orders/${o.id}/status`, body: { status: "cancelled" } },
        ],
      });
    } else if (o.status === "approved") {
      items.push({
        key: `send:${o.id}`, fingerprint: o.status, tab: "inventory", level: "act",
        title: `Send the order to ${o.supplier}`, detail: `"${o.message}"`,
        actions: [
          o.contact.href ? { kind: "open", label: o.contact.label, href: o.contact.href } : { kind: "copy", label: o.contact.label, text: o.message },
          { kind: "post", label: "Mark as sent", path: `/api/purchase-orders/${o.id}/status`, body: { status: "sent" } },
        ],
      });
    }
  }
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  for (const e of events) {
    if (e.kind !== "count" || e.created_at < weekAgo || Number(e.change) >= 0) continue;
    const gap = countGap(Number(e.qty_after) - Number(e.change), Number(e.qty_after));
    if (!gap.notable) continue;
    items.push({
      key: `gap:${e.id}`, fingerprint: "1", tab: "inventory", level: "watch", dismissable: true,
      title: `${e.ingredients?.name}: counted ${fmt(-gap.change)} ${e.ingredients?.unit} less than expected`,
      detail: `Worth ${money(-gap.change * Number(e.unit_cost ?? 0))}. Unlogged waste, heavy portions, or missing stock.`,
      actions: [],
    });
  }
  return {
    items,
    facts: {
      tab: "inventory", items: [],
      numbers: {
        out: out.map((l) => l.name), low: low.map((l) => ({ item: l.name, left: `${fmt(l.estimated)} ${l.unit}`, days_left: l.days_left, reorder_at: l.reorder_point })),
        waste_this_week: money(wasteWeek), orders_waiting: orders.filter((o) => o.status === "draft").length,
        biggest_daily_use: [...lines].sort((a, b) => b.daily_use - a.daily_use).slice(0, 5).map((l) => `${l.name} ${fmt(l.daily_use)} ${l.unit}/day`),
      },
    },
  };
}

// ---------- Prep: the next open day's shortfalls ----------
async function prep(db: Db): Promise<Built> {
  const today = todayLocal();
  let p = await loadPrep(db, addDays(today, 1));
  const next = p.days.find((d) => !d.closed);
  if (p.forecast.closed && next) p = await loadPrep(db, next.date);
  const items: Item[] = [];
  if (p.forecast.closed) return { items, facts: { tab: "prep", items: [], numbers: { note: "closed the whole week" } } };
  const needs = prepNeeds(p.forecast, p.recipes, p.stock);
  const short = needs.filter((n) => n.short > 0 && !n.tight);
  const tight = needs.filter((n) => n.tight);
  const day = `${p.forecast.weekday} ${shortDate(p.date)}`;
  if (short.length) {
    items.push({
      key: `short:${p.date}`, fingerprint: short.map((n) => n.ingredient_id).join(","), tab: "prep", level: "act", dismissable: true,
      title: `${day} is short on ${short.length} ${short.length === 1 ? "item" : "items"}`,
      detail: short.map((n) => `${n.name} (${fmt(n.short)} ${n.unit})`).join(", "),
      actions: [
        { kind: "plan", label: "Plan orders", request: { kind: "prep", date: p.date, factors: {} } },
        { kind: "link", label: "See the prep list", href: `/prep?date=${p.date}` },
      ],
    });
  }
  if (tight.length) {
    items.push({
      key: `tight:${p.date}`, fingerprint: tight.map((n) => n.ingredient_id).join(","), tab: "prep", level: "info", dismissable: true,
      title: `Tight if ${p.forecast.weekday} is busy`, detail: tight.map((n) => n.name).join(", "), actions: [],
    });
  }
  const unsure = p.forecast.dishes.filter((d) => d.confidence === "low");
  if (unsure.length) {
    items.push({
      key: `unsure:${p.date}`, fingerprint: unsure.map((d) => d.id).join(","), tab: "prep", level: "info", dismissable: true,
      title: `Hard to forecast: ${unsure.map((d) => d.name).join(", ")}`, detail: "Recent weeks were very different. Add a note about the day if you know something.",
      actions: [{ kind: "link", label: "Add a note", href: `/prep?date=${p.date}` }],
    });
  }
  return {
    items,
    facts: {
      tab: "prep", items: [],
      numbers: {
        day, dishes_expected: p.forecast.dishes.slice(0, 8).map((d) => `${d.name}: ${d.expected} (${d.low}-${d.high}, ${d.confidence})`),
        short: short.map((n) => `${n.name} short ${fmt(n.short)} ${n.unit}`), tight: tight.map((n) => n.name),
      },
    },
  };
}

// ---------- Invoices: disputes to send, lines to confirm, savings ----------
async function invoices(db: Db): Promise<Built> {
  const since = addDays(todayLocal(), -45);
  const res = await db.from("invoices")
    .select("id, invoice_number, invoice_date, total, status, suppliers(name), invoice_flags(kind, severity, message, money_impact, resolved), invoice_lines(needs_review), invoice_disputes(status, amount_claimed, to_email, sent_at, created_at)")
    .eq("restaurant_id", RESTAURANT_ID).gte("invoice_date", since).order("invoice_date", { ascending: false });
  if (res.error) throw new Error(`Could not load invoices: ${res.error.message}`);
  type Row = {
    id: number; invoice_number: string | null; invoice_date: string; total: number | null; status: string; suppliers: { name: string } | null;
    invoice_flags: { kind: string; severity: string; message: string; money_impact: number | null; resolved: boolean }[];
    invoice_lines: { needs_review: boolean }[];
    invoice_disputes: { status: string; amount_claimed: number; to_email: string | null; sent_at: string | null; created_at: string }[];
  };
  const items: Item[] = [];
  let billedWrong = 0;
  let savings = 0;
  for (const inv of (res.data ?? []) as unknown as Row[]) {
    const name = inv.invoice_number ?? `#${inv.id}`;
    const supplier = inv.suppliers?.name ?? "the supplier";
    const open = inv.invoice_flags.filter((f) => !f.resolved);
    const wrong = open.filter((f) => BILLING_ERROR_KINDS.has(f.kind)).reduce((s, f) => s + Number(f.money_impact ?? 0), 0);
    const dispute = [...inv.invoice_disputes].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    billedWrong += wrong;
    const href = `/invoices/${inv.id}`;
    if (wrong > 0 && !dispute) {
      items.push({
        key: `wrong:${inv.id}`, fingerprint: wrong.toFixed(2), tab: "invoices", level: "act", dismissable: true,
        title: `${supplier} billed ${money(wrong)} wrong on ${name}`, detail: open.filter((f) => BILLING_ERROR_KINDS.has(f.kind)).map((f) => f.message).join(" "),
        actions: [{ kind: "link", label: "Draft a dispute email", href }],
      });
    } else if (dispute?.status === "draft") {
      items.push({
        key: `dispute-draft:${inv.id}`, fingerprint: "draft", tab: "invoices", level: "act",
        title: `Dispute email to ${supplier} is ready to send`, detail: `Asks for ${money(dispute.amount_claimed)} on ${name}.`,
        actions: [{ kind: "link", label: "Review and send", href }],
      });
    } else if (dispute?.status === "sent" && dispute.sent_at && Date.now() - Date.parse(dispute.sent_at) > 5 * 86400_000) {
      items.push({
        key: `dispute-wait:${inv.id}`, fingerprint: dispute.sent_at, tab: "invoices", level: "watch", dismissable: true,
        title: `No credit yet from ${supplier}`, detail: `${money(dispute.amount_claimed)} disputed on ${name}, sent ${shortDate(dispute.sent_at)}. Consider following up.`,
        actions: [{ kind: "link", label: "Open the invoice", href }],
      });
    }
    const review = inv.invoice_lines.filter((l) => l.needs_review).length;
    if (review) {
      items.push({
        key: `review:${inv.id}`, fingerprint: String(review), tab: "invoices", level: "watch",
        title: `Confirm ${review} ${review === 1 ? "line" : "lines"} on ${name}`, detail: "The app wasn't sure which ingredient these are, so they're not in stock or prices yet.",
        actions: [{ kind: "link", label: "Confirm", href }],
      });
    }
    for (const f of open.filter((x) => x.kind === "cheaper_elsewhere")) {
      savings += Number(f.money_impact ?? 0);
      items.push({
        key: `cheaper:${inv.id}:${f.message.slice(0, 40)}`, fingerprint: String(f.money_impact), tab: "invoices", level: "info", dismissable: true,
        title: f.message.split(":")[0] + `: could save ${money(Number(f.money_impact ?? 0))}`, detail: f.message, actions: [{ kind: "link", label: "See the invoice", href }],
      });
    }
  }
  return { items, facts: { tab: "invoices", items: [], numbers: { since, billed_wrong_open: money(billedWrong), possible_savings: money(savings) } } };
}

// ---------- Menu: price changes to approve, and price changes not copied to the POS / apps ----------
async function menu(db: Db): Promise<Built> {
  const { suggestions, delivery, changes } = await loadPricing(db);
  const items: Item[] = [];
  for (const s of suggestions) {
    if (s.action === "ok" || !s.new_price) continue;
    items.push({
      key: `price:${s.dish.id}`, fingerprint: s.new_price.toFixed(2), tab: "menu", dismissable: true,
      level: s.action === "raise" ? "act" : "watch",
      title: s.action === "raise" ? `Raise ${s.dish.name} to ${money(s.new_price)}` : `Look at ${s.dish.name}: the numbers say ${money(s.new_price)}`,
      detail: `${s.reasons[0] ?? ""}${s.action === "raise" ? ` About ${money(s.extra_profit)} more a month.` : ""}`,
      actions: s.action === "raise"
        ? [{ kind: "post", label: `Approve ${money(s.new_price)}`, path: `/api/menu-items/${s.dish.id}/price`, body: { price: s.new_price, reason: s.reasons[0] ?? "" }, primary: true }]
        : [{ kind: "link", label: "Open menu pricing", href: "/menu" }],
    });
  }
  if (delivery.prices.length) {
    items.push({
      key: "delivery-prices", fingerprint: delivery.prices.map((p) => `${p.menu_item_id}:${p.new_delivery_price}`).join(","), tab: "menu", level: "watch", dismissable: true,
      title: `Set delivery app prices for ${delivery.prices.length} dishes`,
      detail: `Apps keep ${delivery.fee_pct}% and your app prices match the menu. About ${money(delivery.extra_profit)} more a month.`,
      actions: [{ kind: "post", label: "Approve", path: "/api/menu/delivery-prices", primary: true }, { kind: "link", label: "See the prices", href: "/menu" }],
    });
  }
  const pending = changes.filter((c) => (Object.keys(SYSTEMS) as System[]).some((s) => !c[`${s}_updated`]));
  if (pending.length) {
    items.push({
      key: "sync", fingerprint: pending.map((c) => c.id).join(","), tab: "menu", level: "act",
      title: `${pending.length} price ${pending.length === 1 ? "change isn't" : "changes aren't"} in the POS or delivery apps yet`,
      detail: pending.slice(0, 4).map((c) => c.menu_items?.name).join(", "), actions: [{ kind: "link", label: "Tick them off", href: "/menu" }],
    });
  }
  return {
    items,
    facts: {
      tab: "menu", items: [],
      numbers: {
        suggestions: suggestions.filter((s) => s.action !== "ok").map((s) => `${s.dish.name}: cost ${money(s.cost_before)} -> ${money(s.cost_now)}, food cost ${s.food_cost_pct}%, suggest ${money(s.new_price ?? 0)}`),
        delivery_extra_profit: money(delivery.extra_profit),
      },
    },
  };
}

// ---------- Accounting: payouts the apps owe, overdue bills ----------
async function accounting(db: Db): Promise<Built> {
  const { checks, bills, owed, restaurant } = await loadAccounting(db);
  const items: Item[] = [];
  for (const c of checks.filter((x) => x.status === "short" || x.status === "missing")) {
    items.push({
      key: `payout:${c.platform}:${c.period_start}`, fingerprint: c.difference.toFixed(2), tab: "accounting", level: "act", dismissable: true,
      title: `${PLATFORMS[c.platform]} ${c.status === "missing" ? "didn't pay" : "paid less"} for the week of ${shortDate(c.period_start)}: ${money(-c.difference)}`,
      detail: c.message, actions: [{ kind: "copy", label: "Copy note to their support", text: payoutDispute(c, restaurant) }],
    });
  }
  for (const b of bills.overdue) {
    items.push({
      key: `overdue:${b.id}`, fingerprint: b.status, tab: "accounting", level: "act",
      title: `Overdue: ${b.supplier} ${money(amountToPay(b.total, b.dispute))}`, detail: `${b.invoice_number ?? ""} was due ${b.due_date ? shortDate(b.due_date) : "?"}.`,
      actions: [{ kind: "post", label: "Mark paid", path: `/api/invoices/${b.id}/paid`, primary: true }, { kind: "link", label: "Open the invoice", href: `/invoices/${b.id}` }],
    });
  }
  if (bills.due_soon.length) {
    items.push({
      key: "due-soon", fingerprint: bills.due_soon.map((b) => b.id).join(","), tab: "accounting", level: "info", dismissable: true,
      title: `${bills.due_soon.length} ${bills.due_soon.length === 1 ? "bill" : "bills"} due this week: ${money(bills.due_soon.reduce((s, b) => s + amountToPay(b.total, b.dispute), 0))}`,
      detail: bills.due_soon.map((b) => `${b.supplier} (${b.due_date ? shortDate(b.due_date) : "?"})`).join(", "), actions: [{ kind: "link", label: "See bills", href: "/accounting" }],
    });
  }
  return {
    items,
    facts: {
      tab: "accounting", items: [],
      numbers: {
        apps_owe: money(owed), payout_weeks_checked: checks.length, payout_problems: checks.filter((c) => c.status === "short" || c.status === "missing").length,
        overdue_total: money(bills.overdue.reduce((s, b) => s + b.total, 0)), due_this_week: money(bills.due_soon.reduce((s, b) => s + b.total, 0)),
      },
    },
  };
}

const BUILDERS: Record<Tab, (db: Db) => Promise<Built>> = { inventory, prep, invoices, menu, accounting };

export async function buildTab(db: Db, tab: Tab): Promise<Built> {
  const built = await BUILDERS[tab](db);
  // The summary is written from the items too (without the buttons)
  built.facts.items = built.items.map((i) => ({ level: i.level, title: i.title, detail: i.detail }));
  return built;
}
