// What needs the owner on each tab (server only). Plain code: each item comes straight from the
// numbers the tab already shows, with the buttons to act on it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { payoutDispute, PLATFORMS } from "@/lib/accounting/reconcile";
import { loadAccounting } from "@/lib/accounting/service";
import { bankNote } from "@/lib/bank/match";
import { loadMoney } from "@/lib/bank/cashPlan";
import { loadBank } from "@/lib/bank/service";
import { loadInventory } from "@/lib/inventory/service";
import { countGap } from "@/lib/inventory/stock";
import { prepNeeds } from "@/lib/prep/forecast";
import { addDays, loadPrep, todayLocal } from "@/lib/prep/service";
import { loadPricing, SYSTEMS, type System } from "@/lib/pricing/service";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import { amountToPay } from "@/lib/purchasing/disputes";
import { loadOrders } from "@/lib/purchasing/service";
import { RESTAURANT_ID } from "@/lib/supabase";
import type { Digest } from "@/lib/analytics";
import { billingImpact, cheaperImpact, deliveryImpact, menuPriceImpact, NO_FIGURE, payoutImpact, priceRiseImpact, stockoutImpact, wasteImpact } from "./impact";
import type { Item, Tab, TabFacts } from "./types";

type Db = SupabaseClient;

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
function shortDate(date: string) {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Whole dollars once amounts are big enough that cents are noise: $1,257 but $46.50
const cash = (n: number) => (Math.abs(n) >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : money(n));
// "in less than a day", "in about a day", "in about 3 days"
function runsOut(days: number | null) {
  if (days === null) return "soon";
  if (days < 1) return "in less than a day";
  if (days < 2) return "in about a day";
  return `in about ${Math.floor(days)} days`;
}
// "A, B and 3 more"
function listShort(names: string[], show = 2) {
  if (names.length <= show) return names.join(" and ");
  return `${names.slice(0, show).join(", ")} and ${names.length - show} more`;
}
// What kind of billing mistake, in a few words
const BILLING_PHRASE: Record<string, string> = {
  math: "a math error", short: "a charge for something not delivered", overcharge: "a price above what you agreed",
  duplicate: "a duplicate invoice", total_mismatch: "lines that don't add up to the total",
};

export type Built = { items: Item[]; facts: TabFacts };

// What running out of each ingredient costs: the dishes that use it (units a day from the last 30
// days, margin per plate) and how long until its supplier can deliver. Null if anything is missing,
// so the bar still shows, just without dollars.
async function stockoutInputs(db: Db) {
  const [recipes, dishes, digest, ingredients, suppliers] = await Promise.all([
    db.from("recipe_items").select("menu_item_id, ingredient_id, qty"),
    db.from("menu_items").select("id, name").eq("restaurant_id", RESTAURANT_ID).eq("active", true),
    db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
    db.from("ingredients").select("id, preferred_supplier_id").eq("restaurant_id", RESTAURANT_ID),
    db.from("suppliers").select("id, lead_time_days").eq("restaurant_id", RESTAURANT_ID),
  ]);
  if (recipes.error || dishes.error || digest.error || ingredients.error || suppliers.error || !digest.data) return null;
  const menu = new Map(((digest.data as Digest).menu ?? []).map((m) => [m.name, m]));
  const days = (digest.data as Digest).period?.days ?? 30;
  const dishName = new Map((dishes.data as { id: number; name: string }[]).map((d) => [d.id, d.name]));
  const lead = new Map((suppliers.data as { id: number; lead_time_days: number | null }[]).map((s) => [s.id, Math.max(1, Number(s.lead_time_days ?? 1))]));
  const preferred = new Map((ingredients.data as { id: number; preferred_supplier_id: number | null }[]).map((i) => [i.id, i.preferred_supplier_id]));
  return {
    dishesFor(ingredientId: number) {
      return (recipes.data as { menu_item_id: number; ingredient_id: number }[])
        .filter((r) => r.ingredient_id === ingredientId)
        .flatMap((r) => {
          const name = dishName.get(r.menu_item_id);
          const row = name ? menu.get(name) : undefined;
          return row && row.unit_margin !== null ? [{ name: row.name, unitsPerDay: row.units / days, margin: row.unit_margin }] : [];
        });
    },
    leadDays: (ingredientId: number) => lead.get(preferred.get(ingredientId) ?? -1) ?? 1,
  };
}

// ---------- Inventory: what's running out, and restock orders to approve and send ----------
async function inventory(db: Db): Promise<Built> {
  const [{ lines, events, wasteWeek }, orders, cost] = await Promise.all([loadInventory(db), loadOrders(db), stockoutInputs(db).catch(() => null)]);
  const items: Item[] = [];
  const out = lines.filter((l) => l.status === "out");
  const low = lines.filter((l) => l.status === "low").sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99));

  for (const l of out) {
    items.push({
      key: `out:${l.id}`, fingerprint: "out", tab: "inventory", level: "act", dismissable: true,
      title: `You're out of ${l.name.toLowerCase()}`, detail: `You use about ${fmt(l.daily_use)} ${l.unit} a day.`,
      actions: [{ kind: "plan", label: "Plan a restock order", request: { kind: "low" } }],
      ...(cost ? stockoutImpact(cost.dishesFor(l.id), cost.leadDays(l.id)) : NO_FIGURE),
      evidence: [{ label: "Daily use", value: `${fmt(l.daily_use)} ${l.unit}`, href: "/inventory" }],
    });
  }
  if (low.length) {
    // Only what runs out before its supplier can deliver costs anything
    const each = cost ? low.map((l) => stockoutImpact(cost.dishesFor(l.id), cost.leadDays(l.id) - (l.days_left ?? 0))) : [];
    const total = each.reduce((s, i) => s + (i.impact_usd_week ?? 0), 0);
    const first = each.find((i) => i.impact_usd_week !== null);
    items.push({
      key: "low", fingerprint: low.map((l) => l.id).join(","), tab: "inventory", dismissable: true,
      level: low.some((l) => (l.days_left ?? 99) < 1) ? "act" : "watch",
      title: low.length === 1 ? `Order more ${low[0].name.toLowerCase()}` : `Order more of ${low.length} items`,
      detail: `${low[0].name} runs out ${runsOut(low[0].days_left)}${low.length > 1 ? `, ${listShort(low.slice(1).map((l) => l.name.toLowerCase()), 2)} soon after` : ""}.`,
      actions: [{ kind: "plan", label: "Plan restock orders", request: { kind: "low" } }],
      ...(first ? { impact_usd_week: Math.round(total * 100) / 100, basis: `For each item that runs out before a delivery can arrive: ${first.basis}`, confidence: "medium" as const, playbook: "stockout_risk" } : NO_FIGURE),
      evidence: low.slice(0, 4).map((l) => ({ label: l.name, value: `${fmt(l.estimated)} ${l.unit} left, ${runsOut(l.days_left).replace(/^in /, "")}` })),
    });
  }
  if (wasteWeek >= 10) {
    items.push({
      key: "waste", fingerprint: wasteWeek.toFixed(0), tab: "inventory", level: "watch", dismissable: true,
      title: `${cash(wasteWeek)} of food thrown out this week`, detail: "The waste log shows what's thrown out most; prep less of it.",
      actions: [{ kind: "link", label: "See the waste log", href: "/inventory/changes" }],
      ...wasteImpact(wasteWeek),
    });
  }
  for (const o of orders) {
    const list = o.lines.map((l) => `${l.qty} x ${l.ingredient}`).join(", ");
    if (o.status === "draft") {
      items.push({
        key: `order:${o.id}`, fingerprint: o.status, tab: "inventory", level: "act",
        title: `Approve the order to ${o.supplier} (${cash(o.total)})`,
        detail: `${list}.${o.below_minimum > 0 ? ` That's ${cash(o.below_minimum)} under their minimum, so they may refuse it.` : ""}`,
        actions: [
          { kind: "post", label: "Approve", path: `/api/purchase-orders/${o.id}/status`, body: { status: "approved" }, primary: true },
          { kind: "post", label: "Deny", path: `/api/purchase-orders/${o.id}/status`, body: { status: "cancelled" } },
        ],
      });
    } else if (o.status === "approved") {
      items.push({
        key: `send:${o.id}`, fingerprint: o.status, tab: "inventory", level: "act",
        title: `Send your order to ${o.supplier}`, detail: `${list}. The message is written for you.`,
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
      title: `${e.ingredients?.name} came up ${fmt(-gap.change)} ${e.ingredients?.unit} short (${cash(-gap.change * Number(e.unit_cost ?? 0))})`,
      detail: "Check for waste that wasn't logged, or portions that are too big.",
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
      title: `Order ${listShort(short.map((n) => n.name.toLowerCase()), 2)} for ${p.forecast.weekday}`,
      detail: `You'll be short about ${short.slice(0, 2).map((n) => `${fmt(n.short)} ${n.unit} of ${n.name.toLowerCase()}`).join(" and ")} if it's busy.`,
      actions: [
        { kind: "plan", label: "Plan orders", request: { kind: "prep", date: p.date, factors: {} } },
        { kind: "link", label: "See the prep list", href: `/prep?date=${p.date}` },
      ],
    });
  }
  if (tight.length) {
    items.push({
      key: `tight:${p.date}`, fingerprint: tight.map((n) => n.ingredient_id).join(","), tab: "prep", level: "info", dismissable: true,
      title: `${listShort(tight.map((n) => n.name), 2)} could run tight if ${p.forecast.weekday} is busy`, actions: [],
    });
  }
  const unsure = p.forecast.dishes.filter((d) => d.confidence === "low");
  if (unsure.length) {
    items.push({
      key: `unsure:${p.date}`, fingerprint: unsure.map((d) => d.id).join(","), tab: "prep", level: "info", dismissable: true,
      title: `${listShort(unsure.map((d) => d.name), 2)}: hard to predict for ${p.forecast.weekday}`, detail: "Sales swung a lot in recent weeks. Add a note if you know something about the day.",
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
// Supplier price changes (from the analytics digest), each ingredient's stock line for its weekly
// use, and each supplier's order minimum, for the dollars on the Invoices tab.
async function marketInputs(db: Db) {
  const [digest, inventory, suppliers] = await Promise.all([
    db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
    loadInventory(db),
    db.from("suppliers").select("name, min_order_amount").eq("restaurant_id", RESTAURANT_ID),
  ]);
  return {
    changes: new Map(((digest.data as Digest | null)?.price_changes ?? []).map((c) => [c.ingredient.toLowerCase(), c])),
    lines: new Map(inventory.lines.map((l) => [l.id, l])),
    minOrder: new Map(((suppliers.data ?? []) as { name: string; min_order_amount: number | null }[]).map((s) => [s.name, Number(s.min_order_amount ?? 0)])),
  };
}

async function invoices(db: Db): Promise<Built> {
  const since = addDays(todayLocal(), -45);
  const [res, market] = await Promise.all([
    db.from("invoices")
      .select("id, invoice_number, invoice_date, total, status, suppliers(name), invoice_flags(kind, severity, message, money_impact, resolved, ingredient_id), invoice_lines(needs_review), invoice_disputes(status, amount_claimed, to_email, sent_at, created_at)")
      .eq("restaurant_id", RESTAURANT_ID).gte("invoice_date", since).order("invoice_date", { ascending: false }),
    marketInputs(db).catch(() => ({ changes: new Map(), lines: new Map(), minOrder: new Map() }) as Awaited<ReturnType<typeof marketInputs>>),
  ]);
  if (res.error) throw new Error(`Could not load invoices: ${res.error.message}`);
  type Row = {
    id: number; invoice_number: string | null; invoice_date: string; total: number | null; status: string; suppliers: { name: string } | null;
    invoice_flags: { kind: string; severity: string; message: string; money_impact: number | null; resolved: boolean; ingredient_id: number | null }[];
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
        title: `${supplier} overcharged you ${cash(wrong)}`,
        detail: `Invoice ${name} has ${listShort([...new Set(open.filter((f) => BILLING_ERROR_KINDS.has(f.kind)).map((f) => BILLING_PHRASE[f.kind] ?? "a billing error"))], 2)}.`,
        actions: [{ kind: "link", label: "Draft a dispute email", href }],
        ...billingImpact(wrong),
        evidence: open.filter((f) => BILLING_ERROR_KINDS.has(f.kind)).slice(0, 4).map((f) => ({ label: BILLING_PHRASE[f.kind] ?? f.kind, value: f.message, href })),
      });
    } else if (dispute?.status === "draft") {
      items.push({
        key: `dispute-draft:${inv.id}`, fingerprint: "draft", tab: "invoices", level: "act",
        title: `Send the dispute email to ${supplier}`, detail: `It asks for a ${cash(dispute.amount_claimed)} credit on ${name}. It's written; just check it.`,
        actions: [{ kind: "link", label: "Review and send", href }],
        ...billingImpact(Number(dispute.amount_claimed)),
      });
    } else if (dispute?.status === "sent" && dispute.sent_at && Date.now() - Date.parse(dispute.sent_at) > 5 * 86400_000) {
      items.push({
        key: `dispute-wait:${inv.id}`, fingerprint: dispute.sent_at, tab: "invoices", level: "watch", dismissable: true,
        title: `${supplier} hasn't sent your ${cash(dispute.amount_claimed)} credit yet`, detail: `You emailed them ${shortDate(dispute.sent_at)}. Time for a follow-up call.`,
        actions: [{ kind: "link", label: "Open the invoice", href }],
      });
    }
    const review = inv.invoice_lines.filter((l) => l.needs_review).length;
    if (review) {
      items.push({
        key: `review:${inv.id}`, fingerprint: String(review), tab: "invoices", level: "watch",
        title: `Check ${review} ${review === 1 ? "item" : "items"} on invoice ${name}`, detail: "The app wasn't sure what it is, so it's not counted in stock yet.",
        actions: [{ kind: "link", label: "Confirm", href }],
      });
    }
    for (const f of open.filter((x) => x.kind === "cheaper_elsewhere")) {
      savings += Number(f.money_impact ?? 0);
      const line = f.ingredient_id ? market.lines.get(f.ingredient_id) : undefined;
      const change = line ? market.changes.get(line.name.toLowerCase()) : undefined;
      const gap = change && change.current_unit_cost !== null && change.cheapest_unit_cost !== null ? change.current_unit_cost - change.cheapest_unit_cost : null;
      items.push({
        key: `cheaper:${inv.id}:${f.message.slice(0, 40)}`, fingerprint: String(f.money_impact), tab: "invoices", level: "info", dismissable: true,
        title: `${f.message.split(":")[0]}: save ${cash(Number(f.money_impact ?? 0))} with another supplier`, actions: [{ kind: "link", label: "See the invoice", href }],
        ...(line && gap !== null && gap > 0 ? cheaperImpact(gap, line.daily_use * 7, line.unit, market.minOrder.get(change!.cheapest_supplier ?? "") ?? 0) : NO_FIGURE),
      });
    }
  }
  // Supplier price rises in the last 30 days, at the supplier we buy from
  for (const c of market.changes.values()) {
    if (!c.is_current_supplier || !(c.change_pct > 0) || c.current_unit_cost === null) continue;
    const line = [...market.lines.values()].find((l) => l.name.toLowerCase() === c.ingredient.toLowerCase());
    if (!line || !(line.daily_use > 0)) continue;
    const oldUnit = c.previous_price && c.current_price ? (c.current_unit_cost * c.previous_price) / c.current_price : null;
    if (oldUnit === null) continue;
    items.push({
      key: `price-rise:${line.id}`, fingerprint: `${c.current_price}:${c.since}`, tab: "invoices", level: "watch", dismissable: true,
      title: `${c.supplier} raised ${c.ingredient.toLowerCase()} ${c.change_pct}%`,
      detail: `${money(c.previous_price!)} to ${money(c.current_price!)} since ${shortDate(c.since)}.${c.cheapest_supplier ? ` ${c.cheapest_supplier} is cheaper.` : ""}`,
      actions: [{ kind: "link", label: "Compare suppliers", href: "/suppliers" }],
      ...priceRiseImpact(c.current_unit_cost, oldUnit, line.daily_use * 7, line.unit),
      evidence: [
        { label: "Price", value: `${money(c.previous_price!)} to ${money(c.current_price!)}`, href: "/suppliers" },
        ...(c.cheapest_supplier && c.cheapest_unit_cost !== null ? [{ label: "Cheaper", value: `${c.cheapest_supplier} at ${money(c.cheapest_unit_cost)}/${line.unit}` }] : []),
        { label: "Dishes", value: c.dishes.slice(0, 4).join(", ") },
      ],
    });
  }
  return { items, facts: { tab: "invoices", items: [], numbers: { since, billed_wrong_open: money(billedWrong), possible_savings: money(savings) } } };
}

// ---------- Menu: price changes to approve, and price changes not copied to the POS / apps ----------
async function menu(db: Db): Promise<Built> {
  const { suggestions, delivery, changes } = await loadPricing(db);
  const items: Item[] = [];
  // Price raises: one item for all of them, so the bar isn't a wall of near-identical rows
  const raises = suggestions.filter((s) => s.action === "raise" && s.new_price);
  if (raises.length) {
    const why = (s: (typeof raises)[number]) =>
      s.cost_change_pct !== null && s.cost_change_pct >= 3 ? `ingredients up ${Math.round(s.cost_change_pct)}%` : "food cost over 30%";
    items.push({
      key: "raises", fingerprint: raises.map((s) => `${s.dish.id}:${s.new_price}`).join(","), tab: "menu", level: "act", dismissable: true,
      title: raises.length === 1
        ? `Raise ${raises[0].dish.name} to ${money(raises[0].new_price!)} (now ${money(raises[0].dish.price)})`
        : `Raise prices on ${raises.length} dishes (about ${cash(raises.reduce((t, s) => t + s.extra_profit, 0))} more a month)`,
      detail: raises.map((s) => `${s.dish.name.replace(/ \(.*\)$/, "")} ${money(s.dish.price)} → ${money(s.new_price!)} (${why(s)})`).join(" · "),
      actions: [
        {
          kind: "posts", label: raises.length === 1 ? `Approve ${money(raises[0].new_price!)}` : `Approve all ${raises.length}`,
          calls: raises.map((s) => ({ path: `/api/menu-items/${s.dish.id}/price`, body: { price: s.new_price, reason: s.reasons[0] ?? "" } })),
        },
        { kind: "link", label: "Change one", href: "/menu" },
      ],
      ...menuPriceImpact(raises.reduce((t, s) => t + s.extra_profit, 0), 30),
      evidence: raises.slice(0, 4).map((s) => ({ label: s.dish.name, value: `cost ${money(s.cost_before)} to ${money(s.cost_now)}, food cost ${s.food_cost_pct}%`, href: "/menu" })),
    });
  }
  for (const s of suggestions.filter((x) => x.action === "review" && x.new_price)) {
    items.push({
      key: `price:${s.dish.id}`, fingerprint: s.new_price!.toFixed(2), tab: "menu", level: "watch", dismissable: true,
      title: `${s.dish.name} costs more to make, but it doesn't sell much`,
      detail: "Raising the price may not help. Look at the recipe or portion first.",
      actions: [{ kind: "link", label: "Open menu pricing", href: "/menu" }],
    });
  }
  if (delivery.prices.length) {
    items.push({
      key: "delivery-prices", fingerprint: delivery.prices.map((p) => `${p.menu_item_id}:${p.new_delivery_price}`).join(","), tab: "menu", level: "watch", dismissable: true,
      title: `Charge more on DoorDash and Uber Eats (${delivery.prices.length} dishes)`,
      detail: `The apps keep ${delivery.fee_pct}% of each order. About ${cash(delivery.extra_profit)} more a month.`,
      actions: [{ kind: "post", label: "Approve", path: "/api/menu/delivery-prices", primary: true }, { kind: "link", label: "See the prices", href: "/menu" }],
      ...deliveryImpact(delivery.extra_profit, 30),
    });
  }
  const pending = changes.filter((c) => (Object.keys(SYSTEMS) as System[]).some((s) => !c[`${s}_updated`]));
  if (pending.length) {
    items.push({
      key: "sync", fingerprint: pending.map((c) => c.id).join(","), tab: "menu", level: "act",
      title: `Update ${pending.length} ${pending.length === 1 ? "price" : "prices"} in your POS and delivery apps`,
      detail: `${listShort(pending.map((c) => c.menu_items?.name ?? "a dish"), 2)} changed here but not there yet.`, actions: [{ kind: "link", label: "Tick them off", href: "/menu" }],
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
  const data = await loadAccounting(db);
  const { checks, bills, owed, restaurant } = data;
  // The bar still works without the bank or the cash plan
  const plan = await loadMoney(db, data).catch(() => null);
  const bank = plan?.bank ?? (await loadBank(db, data).catch(() => ({ connected: false as const })));
  const items: Item[] = [];
  // Simulated bank (Capital One Nessie): payouts that didn't reach the bank, and cash below the reserve
  if (bank.connected) {
    for (const c of bank.problems.filter((x) => x.status === "bank_short" || x.status === "no_deposit")) {
      const reported = Number(c.week.payout?.net_amount ?? 0);
      items.push({
        key: `bank:${c.week.platform}:${c.week.period_start}`, fingerprint: c.shortfall.toFixed(2), tab: "accounting", level: "act", dismissable: true,
        title: c.status === "bank_short"
          ? `${PLATFORMS[c.week.platform]} says it paid ${cash(reported)}, but your bank got ${cash(c.deposit?.amount ?? 0)}`
          : `${PLATFORMS[c.week.platform]}'s ${cash(reported)} payout never reached your bank`,
        detail: `${cash(reported - (c.deposit?.amount ?? 0))} missing, week of ${shortDate(c.week.period_start)}. Your orders, their statement and your bank were checked separately.`,
        actions: [{ kind: "copy", label: "Copy a note for their support", text: bankNote(c, restaurant, bank.account.last4) }],
        ...payoutImpact(reported - (c.deposit?.amount ?? 0)),
      });
    }
    if (bank.cash.spare < 0) {
      items.push({
        key: "reserve", fingerprint: bank.cash.after_bills.toFixed(0), tab: "accounting", level: "act", dismissable: true,
        title: `This week's bills leave ${cash(bank.cash.after_bills)}, below your ${cash(bank.cash.reserve)} cash reserve`,
        detail: "Hold off on non-essential orders, or chase the money the delivery apps owe you.",
        actions: [{ kind: "link", label: "See bills", href: "/accounting" }],
      });
    }
  }
  // Cash plan: the 14-day forecast, spare cash for savings, and the food budget
  if (plan) {
    const { forecast: f, move, budget } = plan;
    if (f.first_below && bank.connected && bank.cash.spare >= 0) {
      items.push({
        key: "forecast-dip", fingerprint: `${f.first_below}:${Math.round(f.lowest.balance)}`, tab: "accounting", level: "watch", dismissable: true,
        title: `Cash is forecast to dip to ${cash(f.lowest.balance)} on ${shortDate(f.lowest.date)}, below your ${cash(f.reserve)} reserve`,
        detail: "An estimate from bills, orders and expected payouts. Hold off on orders that can wait until the next payouts land.",
        actions: [{ kind: "link", label: "See the cash plan", href: "/accounting" }],
      });
    }
    if (move.kind === "now") {
      items.push({
        key: "savings", fingerprint: String(move.amount), tab: "accounting", level: "info", dismissable: true,
        title: `You could move ${cash(move.amount)} to savings and stay above your reserve`,
        detail: `The lowest day in the next two weeks would still be ${cash(move.lowest_after)}. Simulated account, not real money.`,
        actions: [{ kind: "post", label: `Move ${cash(move.amount)} to savings`, path: "/api/bank/savings", body: { amount: move.amount }, primary: true }],
      });
    }
    if (budget && budget.left < 0) {
      items.push({
        key: "food-budget", fingerprint: budget.pct.toFixed(1), tab: "accounting", level: "watch", dismissable: true,
        title: `Food cost is ${budget.pct}% of sales, over your ${budget.target_pct}% target by ${cash(-budget.left)}`,
        detail: budget.top.length ? `Biggest food costs: ${listShort(budget.top.map((t) => t.name), 3)}.` : undefined,
        actions: [{ kind: "link", label: "See menu prices", href: "/menu" }],
      });
    }
  }
  for (const c of checks.filter((x) => x.status === "short" || x.status === "missing")) {
    items.push({
      key: `payout:${c.platform}:${c.period_start}`, fingerprint: c.difference.toFixed(2), tab: "accounting", level: "act", dismissable: true,
      ...payoutImpact(-c.difference),
      title: `${PLATFORMS[c.platform]} owes you ${cash(-c.difference)}`,
      detail: c.status === "missing"
        ? `They never paid for the week of ${shortDate(c.period_start)}.`
        : `They paid short for the week of ${shortDate(c.period_start)}${c.payout?.note ? ` ("${c.payout.note}")` : ""}.`,
      actions: [{ kind: "copy", label: "Copy a note for their support", text: payoutDispute(c, restaurant) }],
    });
  }
  for (const b of bills.overdue) {
    items.push({
      key: `overdue:${b.id}`, fingerprint: b.status, tab: "accounting", level: "act",
      title: `Pay ${b.supplier} ${cash(amountToPay(b.total, b.dispute))}: it's overdue`, detail: `It was due ${b.due_date ? shortDate(b.due_date) : "already"}.`,
      actions: [{ kind: "post", label: "Mark paid", path: `/api/invoices/${b.id}/paid`, primary: true }, { kind: "link", label: "Open the invoice", href: `/invoices/${b.id}` }],
    });
  }
  if (bills.due_soon.length) {
    items.push({
      key: "due-soon", fingerprint: bills.due_soon.map((b) => b.id).join(","), tab: "accounting", level: "info", dismissable: true,
      title: `${bills.due_soon.length} ${bills.due_soon.length === 1 ? "bill" : "bills"} due this week (${cash(bills.due_soon.reduce((s, b) => s + amountToPay(b.total, b.dispute), 0))})`,
      detail: listShort(bills.due_soon.map((b) => `${b.supplier} on ${b.due_date ? shortDate(b.due_date) : "?"}`), 2) + ".", actions: [{ kind: "link", label: "See bills", href: "/accounting" }],
    });
  }
  return {
    items,
    facts: {
      tab: "accounting", items: [],
      numbers: {
        apps_owe: money(owed), payout_weeks_checked: checks.length, payout_problems: checks.filter((c) => c.status === "short" || c.status === "missing").length,
        overdue_total: money(bills.overdue.reduce((s, b) => s + b.total, 0)), due_this_week: money(bills.due_soon.reduce((s, b) => s + b.total, 0)),
        ...(bank.connected
          ? { simulated_bank_balance: money(bank.cash.balance), cash_after_bills: money(bank.cash.after_bills), cash_reserve: money(bank.cash.reserve), not_in_bank: money(bank.owed) }
          : {}),
        ...(plan
          ? {
            forecast_lowest_14_days: money(plan.forecast.lowest.balance), forecast_lowest_on: plan.forecast.lowest.date,
            can_move_to_savings_now: plan.move.kind === "now" ? money(plan.move.amount) : 0,
            food_cost_pct_30_days: plan.budget?.pct ?? null,
          }
          : {}),
      },
    },
  };
}

const BUILDERS: Record<Tab, (db: Db) => Promise<Built>> = { inventory, prep, invoices, menu, accounting };

export async function buildTab(db: Db, tab: Tab): Promise<Built> {
  const built = await BUILDERS[tab](db);
  // Every item carries the impact fields; most have no defensible dollar figure (null, low)
  built.items = built.items.map((i) => ({ impact_usd_week: null, basis: "", evidence: [], confidence: "low", playbook: null, ...i }));
  // The summary is written from the items too (without the buttons)
  built.facts.items = built.items.map((i) => ({ level: i.level, title: i.title, detail: i.detail }));
  return built;
}
