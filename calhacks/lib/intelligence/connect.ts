// Cross-department discoveries (pure). Each rule joins facts the other services already work out
// (the loop's detectors, the impact formulas, recipes, stock, posts, the cash forecast) and only
// fires when every part of the link is in the data. Dollars come from code; a rule with no
// defensible figure says so (impact: null). Nothing here calls a model.
import { ASSUMED_PROMO_LIFT, dishStockUnits, forecastDishWeek, localTime } from "@/lib/agent/investigate";
import { MIN_WEEKLY_USD, priceRiseImpact } from "@/lib/attention/impact";
import { detectSalesDips, RISE_MIN_PCT } from "@/lib/loop/detect";
import { REPOST_AFTER_DAYS } from "@/lib/marketing/targets";
import type { AreaId, Discovery, Loaded } from "./types";

const DAY = 86400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const money = (n: number) => `$${n.toFixed(2)}`;
const key = (s: string) => s.trim().toLowerCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : /(s|sh|ch|x)$/.test(word) ? "es" : "s"}`;

const severityFor = (weekly: number | null, floor: "medium" | "low" = "low"): Discovery["severity"] =>
  weekly !== null && weekly >= 50 ? "high" : weekly !== null && weekly >= MIN_WEEKLY_USD ? "medium" : floor;

// ---------- Purchasing + Menu (+ Inventory): a supplier price rise squeezing dish margins ----------

export function costSqueeze(l: Loaded): Discovery[] {
  if (!l.digest.ok) return [];
  const digest = l.digest.data;
  const lines = l.inventory.ok ? l.inventory.data.lines : [];
  const sales = l.sales.ok ? l.sales.data : null;
  const menu = new Map(digest.menu.map((m) => [key(m.name), m]));
  const days = digest.period.days || 30;

  return digest.price_changes.flatMap((c): Discovery[] => {
    if (!c.is_current_supplier || !(c.change_pct >= RISE_MIN_PCT) || c.current_unit_cost === null || !(c.previous_price > 0) || !(c.current_price > 0)) return [];
    const dishes = c.dishes.map((name) => menu.get(key(name))).filter((m) => m !== undefined);
    if (!dishes.length) return []; // no dish uses it: a purchasing note, not a cross-department one
    const newUnit = c.current_unit_cost;
    const oldUnit = (newUnit * c.previous_price) / c.current_price;
    const line = lines.find((x) => key(x.name) === key(c.ingredient));
    const impact = line && line.daily_use > 0 ? priceRiseImpact(newUnit, oldUnit, line.daily_use * 7, line.unit) : null;
    const weekly = impact?.impact_usd_week ?? null;
    if (weekly !== null && weekly < MIN_WEEKLY_USD) return [];

    // What it adds to each plate, from the recipe, when the recipe is known
    const perPlate = (dishName: string): number | null => {
      if (!sales || !line) return null;
      const dish = sales.dishes.find((d) => key(d.name) === key(dishName));
      const r = dish && sales.recipes.find((x) => x.menu_item_id === dish.id && x.ingredient_id === line.id);
      return r ? round2((newUnit - oldUnit) * r.qty) : null;
    };
    const dishEvidence = dishes.slice(0, 6).map((m) => {
      const extra = perPlate(m.name);
      const weeklyPlates = round1((m.units / days) * 7);
      return {
        area: "menu" as AreaId,
        label: m.name,
        value: `${extra !== null ? `${money(extra)} more a plate, ` : ""}${m.unit_margin !== null ? `${money(m.unit_margin)} margin now, ` : ""}about ${weeklyPlates} plates a week`,
        href: "/menu",
      };
    });
    const cheaper = c.cheapest_supplier && c.cheapest_unit_cost !== null && c.cheapest_unit_cost < newUnit;
    const areas: AreaId[] = line ? ["purchasing", "menu", "inventory"] : ["purchasing", "menu"];

    return [{
      key: `cost-squeeze:${key(c.ingredient)}`,
      kind: "cost_squeeze",
      status: "verified",
      severity: severityFor(weekly, "medium"),
      title: `${c.supplier}'s ${c.change_pct}% ${c.ingredient.toLowerCase()} increase is cutting into ${plural(dishes.length, "dish")}`,
      noticed:
        `${c.supplier} raised ${c.ingredient.toLowerCase()} from ${money(c.previous_price)} to ${money(c.current_price)} a pack on ${c.since}. ` +
        `It goes into ${dishes.map((d) => d.name).join(", ")}${line ? `, and the kitchen uses about ${round1(line.daily_use * 7)} ${line.unit} a week` : ""}.`,
      why: cheaper
        ? `Every plate of those dishes now earns less. ${c.cheapest_supplier} sells it for ${money(c.cheapest_unit_cost!)} per unit against ${money(newUnit)}.`
        : "Every plate of those dishes now earns less, and the menu prices haven't moved.",
      areas,
      impact: weekly !== null && impact ? { amount_usd: weekly, per: "week", basis: impact.basis, assumptions: ["The kitchen keeps using the same amount."] } : null,
      evidence: [
        { area: "purchasing", label: "Price", value: `${money(c.previous_price)} to ${money(c.current_price)} (+${c.change_pct}%) since ${c.since}`, href: "/suppliers" },
        ...(line ? [{ area: "inventory" as AreaId, label: "Weekly use", value: `${round1(line.daily_use * 7)} ${line.unit}`, href: "/inventory" }] : []),
        ...(cheaper ? [{ area: "purchasing" as AreaId, label: "Cheaper option", value: `${c.cheapest_supplier} at ${money(c.cheapest_unit_cost!)} per unit`, href: "/suppliers" }] : []),
        ...dishEvidence,
      ],
      next: {
        label: cheaper ? "Ask the supplier to match, or switch" : "Find out why, and what to do",
        ask: `Why does ${c.ingredient.toLowerCase()} from ${c.supplier} cost ${c.change_pct}% more, which dishes does it hurt, and what should I do about it?`,
        tools: ["investigate_ingredient_cost", "propose_call", "set_menu_price"],
        href: "/suppliers",
        hrefLabel: "Open Suppliers",
      },
      ...(line ? { _caseKey: `price-rise:${line.id}` } : {}),
    } as Discovery & { _caseKey?: string }];
  });
}

// ---------- Sales + Menu + Inventory + Marketing: a dip where a promotion could make sense ----------

export function promoWithStock(l: Loaded): Discovery[] {
  if (!l.sales.ok || !l.digest.ok || !l.inventory.ok) return [];
  const { lines, dishes, recipes } = l.sales.data;
  const digest = l.digest.data;
  const menu = new Map(digest.menu.map((m) => [key(m.name), m]));
  const threshold = digest.menu_thresholds.margin_threshold;
  const onHand = new Map(l.inventory.data.lines.map((x) => [x.id, x.estimated]));
  const canMake = dishStockUnits(recipes, onHand);
  const posts = l.posts.ok ? l.posts.data : [];
  const nowMs = Date.parse(l.now);

  // The same tests campaign_options uses, so this page and that tool agree about a dish: stock
  // covers a forecast week at the assumed promotion lift, and "last posted" counts a draft from the
  // last 7 days as just posted.
  const daily = new Map<string, { day: string; menu_item_id: number; units: number }>();
  for (const s of lines) {
    const day = localTime(s.ordered_at).day;
    const row = daily.get(`${day}|${s.menu_item_id}`) ?? { day, menu_item_id: s.menu_item_id, units: 0 };
    row.units += s.qty;
    daily.set(`${day}|${s.menu_item_id}`, row);
  }
  const forecastWeek = forecastDishWeek([...daily.values()], dishes, localTime(l.now).day);
  const lastPosted = (dish: string) =>
    posts
      .filter((p) => key(p.dish_name ?? "") === key(dish))
      .map((p) => (p.status === "posted" || p.status === "published" ? p.posted_at ?? p.created_at : p.status === "draft" && nowMs - Date.parse(p.created_at) < 7 * DAY ? p.created_at : null))
      .filter((at): at is string => at !== null)
      .map((at) => Date.parse(at))
      .sort((a, b) => b - a)[0] ?? null;
  const draftFor = (dish: string) => posts.find((p) => key(p.dish_name ?? "") === key(dish) && p.status === "draft") ?? null;

  return detectSalesDips(lines, dishes, l.now).flatMap((dip): Discovery[] => {
    const f = dip.facts as { daypart: string; weekend: boolean; drop_pct: number; dishes_down: { id: number; dish: string; before: number; now: number; drop: number }[] };
    const seg = `${f.weekend ? "weekend" : "weekday"} ${f.daypart}`;
    const candidates = f.dishes_down.flatMap((d) => {
      const m = menu.get(key(d.dish));
      if (!m || m.unit_margin === null || (threshold !== null && m.unit_margin < threshold)) return []; // only dishes that earn their keep
      const plates = canMake.get(d.id);
      const promoWeek = round1((forecastWeek.get(d.id) ?? 0) * ASSUMED_PROMO_LIFT);
      if (plates === undefined || Math.floor(plates) < promoWeek) return []; // no recipe, or not enough stock for a promotion week
      const posted = lastPosted(d.dish);
      if (posted !== null && nowMs - posted < REPOST_AFTER_DAYS * DAY) return []; // already promoted recently
      return [{ ...d, margin: m.unit_margin, plates: Math.floor(plates), promoWeek, posted, draft: draftFor(d.dish) }];
    });
    const best = candidates.sort((a, b) => b.margin * b.drop - a.margin * a.drop)[0];
    if (!best) return [];

    return [{
      key: `promo-with-stock:${f.daypart}:${f.weekend ? "weekend" : "weekday"}:${best.id}`,
      kind: "promo_with_stock",
      status: "hypothesis",
      severity: severityFor(dip.impact_usd_week),
      title: `${seg[0].toUpperCase()}${seg.slice(1)} is down ${Math.round(f.drop_pct)}%, and ${best.dish} has the margin and stock for a promotion`,
      noticed:
        `${seg[0].toUpperCase()}${seg.slice(1)} revenue fell ${Math.round(f.drop_pct)}% over the last 14 days. ${best.dish} went from ${best.before} to ${best.now} plates a day in that slot, ` +
        `earns ${money(best.margin)} a plate, and today's stock makes about ${best.plates}, enough for a promotion week (${best.promoWeek} expected at an assumed ${ASSUMED_PROMO_LIFT}x lift). ` +
        `${best.posted === null ? "It hasn't been promoted recently" : `It was last promoted ${Math.round((nowMs - best.posted) / DAY)} days ago`}.`,
      why: "A targeted promotion uses stock already paid for on a dish that earns well. Whether it brings plates back is a guess, so it's measured against the usual weeks afterward.",
      areas: ["sales", "menu", "inventory", "marketing"],
      impact: dip.impact_usd_week !== null
        ? { amount_usd: dip.impact_usd_week, per: "week", basis: `Revenue already lost in this slot: ${dip.basis}`, assumptions: ["This is the gap so far, not what a promotion would win back.", "A drop does not prove the dish caused it."] }
        : null,
      evidence: [
        ...dip.evidence.slice(0, 2).map((e) => ({ area: "sales" as AreaId, ...e, href: "/analytics" })),
        { area: "sales", label: best.dish, value: `${best.before} to ${best.now} plates a day`, href: "/analytics" },
        { area: "menu", label: "Margin", value: `${money(best.margin)} a plate${threshold !== null ? ` (menu average ${money(threshold)})` : ""}`, href: "/menu" },
        { area: "inventory", label: "Stock", value: `makes about ${best.plates}; a promotion week needs ${best.promoWeek}`, href: "/inventory" },
        { area: "marketing", label: "Last promoted", value: best.posted === null ? `not in the last ${REPOST_AFTER_DAYS} days` : `${Math.round((nowMs - best.posted) / DAY)} days ago`, href: "/marketing" },
        ...(best.draft ? [{ area: "marketing" as AreaId, label: "Draft waiting", value: `A ${best.dish} post is drafted and not published`, href: "/marketing" }] : []),
      ],
      next: {
        label: "Plan a targeted promotion",
        ask: `${seg[0].toUpperCase()}${seg.slice(1)} revenue is down ${Math.round(f.drop_pct)}%. Does a ${f.daypart} promotion on ${best.dish} make sense? Check campaign_options and draft one if it does.`,
        tools: ["campaign_options", "draft_campaign", "start_promotion"],
        href: "/marketing",
        hrefLabel: "Open Marketing",
      },
      _caseKey: dip.finding_key,
    } as Discovery & { _caseKey: string }];
  });
}

// ---------- Inventory + Prep: the same ingredient thrown out again and again ----------

export const WASTE_MIN_EVENTS = 2;
const PREP_REASONS = new Set(["spoiled", "expired", "overcooked"]);

export function wastePrep(l: Loaded): Discovery[] {
  if (!l.waste.ok) return [];
  const byIngredient = new Map<number, { name: string; unit: string; qty: number; cost: number; events: number; reasons: Map<string, number> }>();
  for (const w of l.waste.data) {
    const g = byIngredient.get(w.ingredient_id) ?? { name: w.name, unit: w.unit, qty: 0, cost: 0, events: 0, reasons: new Map() };
    g.qty += w.qty;
    g.cost += w.cost;
    g.events += 1;
    if (w.reason) g.reasons.set(w.reason, (g.reasons.get(w.reason) ?? 0) + 1);
    byIngredient.set(w.ingredient_id, g);
  }
  const sales = l.sales.ok ? l.sales.data : null;
  return [...byIngredient.entries()].flatMap(([id, g]): Discovery[] => {
    const weekly = round2(g.cost / 2); // 14 days of waste, per week
    if (g.events < WASTE_MIN_EVENTS || weekly < MIN_WEEKLY_USD) return [];
    const prepLike = [...g.reasons.keys()].some((r) => PREP_REASONS.has(r));
    const reasons = [...g.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}x`).join(", ");
    const usedIn = sales ? sales.recipes.filter((r) => r.ingredient_id === id).map((r) => sales.dishes.find((d) => d.id === r.menu_item_id)?.name).filter(Boolean) : [];
    return [{
      key: `waste-prep:${id}`,
      kind: "waste_prep",
      status: prepLike ? "verified" : "hypothesis",
      severity: severityFor(weekly),
      title: `${g.name} was thrown out ${g.events} times in two weeks`,
      noticed: `${round1(g.qty)} ${g.unit} of ${g.name.toLowerCase()} (${money(g.cost)} at cost) went in the waste log in the last 14 days${reasons ? `: ${reasons}` : ""}.`,
      why: prepLike
        ? "Spoiled, expired or overcooked stock usually means more was prepped or bought than sold. A smaller prep or order saves the cost."
        : "Repeated waste costs money; the log doesn't say why, so check before changing prep.",
      areas: ["inventory"],
      impact: { amount_usd: weekly, per: "week", basis: `${money(g.cost)} of waste logged in 14 days, halved for a week. Cutting it saves up to this.`, assumptions: ["The waste log is complete."] },
      evidence: [
        { area: "inventory", label: "Waste logged", value: `${round1(g.qty)} ${g.unit}, ${money(g.cost)}, ${plural(g.events, "time")}`, href: "/inventory" },
        ...(reasons ? [{ area: "inventory" as AreaId, label: "Reasons", value: reasons }] : []),
        ...(usedIn.length ? [{ area: "inventory" as AreaId, label: "Used in", value: usedIn.slice(0, 4).join(", "), href: "/prep" }] : []),
      ],
      next: {
        label: "Adjust prep",
        ask: `${g.name} keeps getting thrown out (${g.events} times in two weeks). Look at the waste log and the prep plan and suggest a prep change.`,
        tools: ["list_inventory", "get_prep_plan", "adjust_prep_for_day"],
        href: "/prep",
        hrefLabel: "Open Prep",
      },
    }];
  });
}

// ---------- Finance + Purchasing: orders waiting for approval vs the cash plan ----------

export function cashPressure(l: Loaded): Discovery[] {
  if (!l.money.ok || !l.money.data.connected || !l.orders.ok) return [];
  const m = l.money.data;
  if (m.lowest === null || m.reserve === null) return [];
  const drafts = l.orders.data.filter((o) => o.status === "draft" && o.total > 0);
  const draftTotal = round2(drafts.reduce((s, o) => s + o.total, 0));
  const lowestAfter = round2(m.lowest.balance - draftTotal);
  const dueSoon = [...m.bills.overdue, ...m.bills.due_soon];
  const dueTotal = round2(dueSoon.reduce((s, b) => s + b.total, 0));
  if (!m.first_below && !(drafts.length && lowestAfter < m.reserve)) return [];

  return [{
    key: "cash-pressure",
    kind: "cash_pressure",
    status: "verified",
    severity: m.first_below || lowestAfter < 0 ? "high" : "medium",
    title: m.first_below
      ? `Cash dips under the reserve on ${m.first_below}${drafts.length ? `, before ${plural(drafts.length, "order")} waiting for approval` : ""}`
      : `Approving ${plural(drafts.length, "waiting order")} would take cash under the reserve`,
    noticed:
      `The two-week cash plan bottoms out at ${money(m.lowest.balance)} on ${m.lowest.date}, against a ${money(m.reserve)} reserve. ` +
      `${drafts.length ? `${plural(drafts.length, "purchase order")} worth ${money(draftTotal)} are waiting for approval and aren't in that plan yet. ` : ""}` +
      `${dueSoon.length ? `${plural(dueSoon.length, "bill")} worth ${money(dueTotal)} are overdue or due soon.` : ""}`,
    why: "Committing to orders before the bills and payouts line up can leave too little cash on the low day.",
    areas: ["finance", "purchasing"],
    impact: null,
    evidence: [
      { area: "finance", label: "Lowest day", value: `${money(m.lowest.balance)} on ${m.lowest.date}`, href: "/accounting" },
      { area: "finance", label: "Reserve", value: money(m.reserve), href: "/accounting" },
      ...(drafts.length ? [{ area: "purchasing" as AreaId, label: "Waiting orders", value: `${drafts.map((o) => `${o.supplier} ${money(o.total)}`).slice(0, 3).join(", ")}`, href: "/invoices" }] : []),
      ...(drafts.length ? [{ area: "finance" as AreaId, label: "Lowest day if approved", value: money(lowestAfter) }] : []),
      ...(dueSoon.length ? [{ area: "finance" as AreaId, label: "Bills due soon", value: `${plural(dueSoon.length, "bill")}, ${money(dueTotal)}`, href: "/accounting" }] : []),
    ],
    next: {
      label: "Check the cash plan first",
      ask: "Can we afford the purchase orders waiting for approval? Walk me through the cash plan for the next two weeks and what to approve first.",
      tools: ["get_cash_plan", "list_purchase_orders"],
      href: "/accounting",
      hrefLabel: "Open Accounting",
    },
  }];
}

// ---------- Purchasing + Finance: a billing error on a bill that's still unpaid ----------

export function billingBeforePayment(l: Loaded): Discovery[] {
  if (!l.money.ok) return [];
  const { overdue, due_soon, later } = l.money.data.bills;
  return [...overdue, ...due_soon, ...later]
    .filter((b) => b.disputed > 0 && (b.dispute_status === null || b.dispute_status === "draft"))
    .sort((a, b) => b.disputed - a.disputed)
    .slice(0, 3)
    .map((b): Discovery => ({
      key: `billing-before-payment:${b.id}`,
      kind: "billing_before_payment",
      status: "verified",
      severity: b.disputed >= 50 ? "high" : "medium",
      title: `${b.supplier} invoice ${b.invoice_number ?? `#${b.id}`} has ${money(b.disputed)} in billing errors and isn't paid yet`,
      noticed: `The invoice check found ${money(b.disputed)} charged in error on a ${money(b.total)} bill${b.due_date ? ` due ${b.due_date}` : ""}. ${b.dispute_status === "draft" ? "A dispute is drafted but not sent." : "No dispute has been sent."}`,
      why: "It's easiest to get the money back before the bill is paid.",
      areas: ["purchasing", "finance"],
      impact: { amount_usd: round2(b.disputed), per: "once", basis: "What the invoice check found charged in error (a one-time amount to get back).", assumptions: [] },
      evidence: [
        { area: "purchasing", label: "Charged in error", value: money(b.disputed), href: `/invoices/${b.id}` },
        { area: "finance", label: "Bill", value: `${money(b.total)}${b.due_date ? `, due ${b.due_date}` : ""}`, href: "/accounting" },
      ],
      next: {
        label: "Dispute it before paying",
        ask: `${b.supplier} invoice ${b.invoice_number ?? `#${b.id}`} has ${money(b.disputed)} in billing errors and isn't paid. Draft the dispute so I can send it before we pay.`,
        tools: ["save_dispute_draft", "send_dispute"],
        href: `/invoices/${b.id}`,
        hrefLabel: "Open the invoice",
      },
    }));
}

// ---------- All of them ----------

const SEVERITY = { high: 0, medium: 1, low: 2 };

// Every rule, deduplicated by key, each tied to the loop's open case about the same thing (so the
// page and the agent point at the case instead of starting a second one), most important first.
export function discover(l: Loaded): Discovery[] {
  const cases = l.cases.ok ? l.cases.data.filter((c) => !["closed", "dismissed", "failed"].includes(c.status)) : [];
  const seen = new Set<string>();
  const out: Discovery[] = [];
  for (const rule of [costSqueeze, promoWithStock, wastePrep, cashPressure, billingBeforePayment]) {
    let found: (Discovery & { _caseKey?: string })[] = [];
    try {
      found = rule(l);
    } catch {
      continue; // one broken rule never hides the others
    }
    for (const { _caseKey, ...d } of found) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      const match = _caseKey ? cases.find((c) => c.finding_key === _caseKey) : undefined;
      out.push(match ? { ...d, case: { id: match.id, status: match.status } } : d);
    }
  }
  return out.sort(
    (a, b) =>
      SEVERITY[a.severity] - SEVERITY[b.severity] ||
      (a.status === b.status ? 0 : a.status === "verified" ? -1 : 1) ||
      (b.impact?.amount_usd ?? -1) - (a.impact?.amount_usd ?? -1),
  );
}
