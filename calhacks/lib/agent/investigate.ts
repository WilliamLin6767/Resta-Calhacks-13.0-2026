// The agent's investigations, in code (pure: data in, findings out, no database and no AI).
// Each one gathers the evidence for a question and works out every dollar figure itself, with a
// basis string that says how. Claude only ranks, explains and picks among what these return.
//
//   profitOpportunities   "How can I make more money this week?"
//   ingredientCost        "Why is our beef costing so much?"
//   restockOptions        "We're low on chicken. What's our best option?"
//   campaignOptions       "What should we promote this week?"
import type { Digest } from "@/lib/analytics";
import type { MarketExplanation } from "@/lib/market/judge";
import { forecastDay, type DishRef, type SalesRow } from "@/lib/prep/forecast";
import { TARGET_FOOD_COST, type DeliveryPlan, type Suggestion } from "@/lib/pricing/pricing";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import type { Plan } from "@/lib/purchasing/plan";
import { reorderQty, type StockLine } from "@/lib/inventory/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const money = (n: number) => `$${n.toFixed(2)}`;
const toWeek = (amount: number, days: number) => (amount * 7) / Math.max(1, days);
const key = (name: string) => name.trim().toLowerCase();

type MenuRow = Digest["menu"][number];
type PriceChangeRow = Digest["price_changes"][number];

// ---------- Times of day (Pacific time) ----------

export const TIME_ZONE = "America/Los_Angeles";
export const DAYPARTS = {
  lunch: { from: 11 * 60, to: 14 * 60 + 30, label: "lunch (11:00 to 2:30)" },
  dinner: { from: 17 * 60, to: 21 * 60 + 30, label: "dinner (5:00 to 9:30)" },
} as const;
export type Daypart = keyof typeof DAYPARTS;

const clock = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" });

// The Pacific date, minutes after midnight and weekend flag of a timestamp.
export function localTime(iso: string): { day: string; minutes: number; weekend: boolean } {
  const parts = Object.fromEntries(clock.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
  };
}

export function daypartOf(iso: string): Daypart | null {
  const { minutes } = localTime(iso);
  for (const [name, part] of Object.entries(DAYPARTS) as [Daypart, (typeof DAYPARTS)[Daypart]][]) {
    if (minutes >= part.from && minutes < part.to) return name;
  }
  return null;
}

// ---------- profit_opportunities ----------

export type FlagRow = {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  supplier: string;
  ingredient_id: number | null;
  kind: string;
  message: string;
  money_impact: number | null;
  resolved: boolean;
};

export type Opportunity = {
  kind: "price_raise" | "billing_error" | "cheaper_supplier" | "waste" | "low_margin" | "delivery_price";
  title: string;
  amount_usd: number | null; // null when there's no defensible figure
  per: "week" | "once";
  basis: string; // how the figure was worked out, and what it assumes
  evidence: Record<string, unknown>;
  next_step: string; // the tool or page that acts on it
};

export function profitOpportunities(input: {
  days: number; // the period the sales numbers cover
  suggestions: Suggestion[];
  delivery: DeliveryPlan;
  flags: FlagRow[];
  wasteWeek: number;
  menu: MenuRow[];
  marginThreshold: number | null;
  priceChanges: PriceChangeRow[];
  weeklyUse: Map<string, { qty: number; unit: string }>; // by ingredient name (lowercase)
}): Opportunity[] {
  const { days } = input;
  const out: Opportunity[] = [];
  const raised = new Set<string>();

  for (const s of input.suggestions) {
    if (s.action !== "raise" || s.new_price === null) continue;
    raised.add(key(s.dish.name));
    out.push({
      kind: "price_raise",
      title: `Raise ${s.dish.name} from ${money(s.dish.price)} to ${money(s.new_price)}`,
      amount_usd: round2(toWeek(s.extra_profit, days)),
      per: "week",
      basis: `(${money(s.new_price)} - ${money(s.dish.price)}) x ${s.dish.units} sold in the last ${days} days, per week. Assumes the same number sell.`,
      evidence: { cost_now: s.cost_now, cost_before: s.cost_before, food_cost_pct: s.food_cost_pct, in_steps: s.in_steps, reasons: s.reasons },
      next_step: "set_menu_price (the owner approves it)",
    });
  }

  for (const f of input.flags) {
    if (f.resolved || !BILLING_ERROR_KINDS.has(f.kind) || !(Number(f.money_impact) > 0)) continue;
    out.push({
      kind: "billing_error",
      title: `${f.supplier} invoice ${f.invoice_number ?? `#${f.invoice_id}`}: ${f.message}`,
      amount_usd: round2(Number(f.money_impact)),
      per: "once",
      basis: "The amount the invoice check found charged in error.",
      evidence: { flag_id: f.id, invoice_id: f.invoice_id, kind: f.kind },
      next_step: "save_dispute_draft, or propose_call to the supplier",
    });
  }

  // A cheaper supplier, from the price changes: the gap per unit x what we use in a week.
  for (const c of input.priceChanges) {
    const current = c.current_unit_cost;
    const cheapest = c.cheapest_unit_cost;
    if (current === null || cheapest === null || c.cheapest_supplier === null || !(current > cheapest)) continue;
    const use = input.weeklyUse.get(key(c.ingredient));
    if (!use || use.qty <= 0) continue;
    const gap = current - cheapest;
    out.push({
      kind: "cheaper_supplier",
      title: `Buy ${c.ingredient} from ${c.cheapest_supplier} instead of ${c.supplier}`,
      amount_usd: round2(gap * use.qty),
      per: "week",
      basis: `(${money(current)} - ${money(cheapest)}) per ${use.unit} x ${round1(use.qty)} ${use.unit} used a week. Assumes the same use, before any order minimum.`,
      evidence: { supplier: c.supplier, current_price: c.current_price, previous_price: c.previous_price, change_pct: c.change_pct, since: c.since, cheapest_supplier: c.cheapest_supplier },
      next_step: "investigate_ingredient_cost, then propose_call or draft_order_plan",
    });
  }
  for (const f of input.flags) {
    if (f.resolved || f.kind !== "cheaper_elsewhere" || !(Number(f.money_impact) > 0)) continue;
    out.push({
      kind: "cheaper_supplier",
      title: `${f.supplier} invoice ${f.invoice_number ?? `#${f.invoice_id}`}: ${f.message}`,
      amount_usd: round2(Number(f.money_impact)),
      per: "once",
      basis: "What the same items on this invoice would have cost from the cheapest supplier.",
      evidence: { flag_id: f.id, invoice_id: f.invoice_id },
      next_step: "investigate_ingredient_cost",
    });
  }

  if (input.wasteWeek > 0) {
    out.push({
      kind: "waste",
      title: `Waste in the last 7 days: ${money(input.wasteWeek)}`,
      amount_usd: round2(input.wasteWeek),
      per: "week",
      basis: "Waste logged in the last 7 days, at cost. Cutting it saves up to this much a week.",
      evidence: {},
      next_step: "list_inventory (the waste log), and adjust prep with get_prep_plan",
    });
  }

  // Popular but low margin (plowhorses) whose food cost is over target, without a price suggestion
  // already listed. The figure is what bringing food cost to target (by price or recipe) would add.
  // A cheap dish with a normal food cost isn't listed: its low margin comes from its price point.
  for (const m of input.menu) {
    if (m.class !== "plowhorse" || m.unit_food_cost === null || raised.has(key(m.name))) continue;
    const over = m.unit_food_cost - TARGET_FOOD_COST * m.price;
    if (over <= 0) continue;
    out.push({
      kind: "low_margin",
      title: `${m.name} sells well but its food cost is ${m.food_cost_pct}% (target ${TARGET_FOOD_COST * 100}%)`,
      amount_usd: round2(toWeek(over * m.units, days)),
      per: "week",
      basis: `(${money(m.unit_food_cost)} cost - ${TARGET_FOOD_COST * 100}% of ${money(m.price)}) x ${m.units} sold in the last ${days} days, per week. What reaching the target food cost would add; assumes demand holds.`,
      evidence: { price: m.price, unit_food_cost: m.unit_food_cost, unit_margin: m.unit_margin, menu_average_margin: input.marginThreshold },
      next_step: "list_menu (price or recipe)",
    });
  }

  if (input.delivery.prices.length && input.delivery.extra_profit > 0) {
    out.push({
      kind: "delivery_price",
      title: `${input.delivery.prices.length} delivery-app price${input.delivery.prices.length === 1 ? "" : "s"} below target`,
      amount_usd: round2(toWeek(input.delivery.extra_profit, days)),
      per: "week",
      basis: `The gap to the suggested app prices x app sales in the last ${days} days, per week. Assumes the same number sell.`,
      evidence: { prices: input.delivery.prices.slice(0, 6), app_fee_pct: input.delivery.fee_pct },
      next_step: "set_delivery_prices (the owner approves it)",
    });
  }

  return out.sort((a, b) => (b.amount_usd ?? -1) - (a.amount_usd ?? -1));
}

// ---------- investigate_ingredient_cost ----------

export type PricePoint = { supplier_id: number; supplier: string; pack_desc: string | null; pack_qty: number; price: number; effective_date: string };
export type InvoiceLineRow = { invoice_id: number; invoice_number: string | null; invoice_date: string; supplier: string; qty: number; unit_price: number; pack_qty: number | null };
export type CallSummary = { id: number; title: string; status: string; outcome: string | null; created_at: string };

const unitCost = (p: PricePoint) => (p.pack_qty > 0 ? p.price / p.pack_qty : p.price);

export function ingredientCost(input: {
  ingredient: { id: number; name: string; unit: string };
  preferredSupplierId: number | null;
  prices: PricePoint[]; // every supplier's prices for this ingredient
  invoiceLines: InvoiceLineRow[];
  flags: FlagRow[];
  market: MarketExplanation | null;
  calls: CallSummary[];
  recipes: { menu_item_id: number; qty: number }[]; // recipe lines using this ingredient
  dishes: { id: number; name: string }[];
  menu: MenuRow[]; // digest menu (units sold, by name)
  days: number;
  weeklyUse: number | null; // in the ingredient's unit
}) {
  const { ingredient, days } = input;
  const bySupplier = new Map<number, PricePoint[]>();
  for (const p of [...input.prices].sort((a, b) => b.effective_date.localeCompare(a.effective_date))) {
    bySupplier.set(p.supplier_id, [...(bySupplier.get(p.supplier_id) ?? []), p]);
  }
  // The supplier we buy from: the preferred one, else whoever has the latest price
  const currentId = input.preferredSupplierId !== null && bySupplier.has(input.preferredSupplierId) ? input.preferredSupplierId : input.prices.length ? [...bySupplier.keys()][0] : null;
  const ours = currentId === null ? [] : bySupplier.get(currentId)!;
  const now = ours[0] ?? null;
  const before = ours.find((p) => p.price !== now?.price) ?? null;
  const unitNow = now ? unitCost(now) : null;
  const unitBefore = before ? unitCost(before) : unitNow;
  const change_pct = now && before ? round1(((unitCost(now) - unitCost(before)) / unitCost(before)) * 100) : null;

  const alternatives = [...bySupplier.entries()]
    .filter(([id]) => id !== currentId)
    .map(([, list]) => {
      const latest = list[0];
      const gap = unitNow !== null ? unitNow - unitCost(latest) : null;
      return {
        supplier: latest.supplier,
        pack: latest.pack_desc,
        price: latest.price,
        unit_cost: round2(unitCost(latest)),
        since: latest.effective_date,
        cheaper_by_per_unit: gap !== null ? round2(gap) : null,
        weekly_saving: gap !== null && gap > 0 && input.weeklyUse ? round2(gap * input.weeklyUse) : null,
      };
    })
    .sort((a, b) => a.unit_cost - b.unit_cost);

  const delta = unitNow !== null && unitBefore !== null ? unitNow - unitBefore : 0;
  const unitsByName = new Map(input.menu.map((m) => [key(m.name), m]));
  const dishes = input.recipes
    .map((r) => {
      const dish = input.dishes.find((d) => d.id === r.menu_item_id);
      if (!dish) return null;
      const row = unitsByName.get(key(dish.name));
      const perPlate = r.qty * delta;
      return {
        dish: dish.name,
        uses: `${r.qty} ${ingredient.unit}`,
        cost_change_per_plate: round2(perPlate),
        margin_now: row ? row.unit_margin : null,
        weekly_margin_change: row ? round2(-toWeek(perPlate * row.units, days)) : null,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => (a.weekly_margin_change ?? 0) - (b.weekly_margin_change ?? 0));

  const weeklyCostRise = input.weeklyUse && delta > 0 ? round2(delta * input.weeklyUse) : null;
  return {
    ingredient: ingredient.name,
    unit: ingredient.unit,
    current: now ? { supplier: now.supplier, pack: now.pack_desc, price: now.price, unit_cost: round2(unitCost(now)), since: now.effective_date } : null,
    before: before ? { price: before.price, unit_cost: round2(unitCost(before)), since: before.effective_date } : null,
    change_pct,
    weekly_use: input.weeklyUse !== null ? round1(input.weeklyUse) : null,
    weekly_cost_rise: weeklyCostRise,
    weekly_cost_rise_basis: weeklyCostRise !== null ? `(${money(unitNow!)} - ${money(unitBefore!)}) per ${ingredient.unit} x ${round1(input.weeklyUse!)} ${ingredient.unit} a week. Assumes the same use.` : null,
    history: ours.slice(0, 8).map((p) => ({ price: p.price, pack: p.pack_desc, date: p.effective_date })),
    market: input.market,
    alternatives,
    recent_invoices: input.invoiceLines.slice(0, 6),
    open_flags: input.flags.filter((f) => !f.resolved).map((f) => ({ id: f.id, invoice: f.invoice_number ?? `#${f.invoice_id}`, kind: f.kind, message: f.message, money_impact: f.money_impact })),
    past_calls: input.calls.slice(0, 5),
    dishes_affected: dishes,
  };
}

// ---------- restock_options ----------

// Expected use of one ingredient over the next `days` days, from each day's dish forecast and the recipes.
export function forecastIngredientUse(sales: SalesRow[], dishes: DishRef[], recipes: { menu_item_id: number; ingredient_id: number; qty: number }[], ingredientId: number, startDate: string, days = 7) {
  const perDish = new Map(recipes.filter((r) => r.ingredient_id === ingredientId).map((r) => [r.menu_item_id, Number(r.qty)]));
  let total = 0;
  const byDay: { date: string; use: number; closed: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(`${startDate}T12:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
    const f = forecastDay(sales, dishes, date);
    const use = f.closed ? 0 : f.dishes.reduce((s, d) => s + d.expected * (perDish.get(d.id) ?? 0), 0);
    total += use;
    byDay.push({ date, use: round1(use), closed: f.closed });
  }
  return { total: round1(total), byDay };
}

// Expected units of every dish over the next `days` days.
export function forecastDishWeek(sales: SalesRow[], dishes: DishRef[], startDate: string, days = 7): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(`${startDate}T12:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
    const f = forecastDay(sales, dishes, date);
    if (f.closed) continue;
    for (const d of f.dishes) out.set(d.id, round1((out.get(d.id) ?? 0) + d.expected));
  }
  return out;
}

export function restockOptions(input: {
  line: StockLine;
  forecast: { total: number; byDay: { date: string; use: number; closed: boolean }[] };
  plan: Plan;
  cash: { start: number; reserve: number; lowest: { date: string; balance: number } } | null;
}) {
  const { line, forecast, plan } = input;
  const needed = round1(Math.max(reorderQty(line), forecast.total - line.estimated, 0));
  const total = plan.total;
  const runsOut = (() => {
    let left = line.estimated;
    for (const d of forecast.byDay) {
      left -= d.use;
      if (left < 0) return d.date;
    }
    return null;
  })();
  return {
    ingredient: line.name,
    unit: line.unit,
    on_hand: line.estimated,
    par: line.par_level,
    status: line.status,
    days_left: line.days_left,
    next_7_days_use: forecast.total,
    runs_out_on: runsOut,
    needed,
    needed_basis: `The larger of par minus on hand (${reorderQty(line)} ${line.unit}) and the next 7 days' forecast minus on hand (${round1(forecast.total - line.estimated)} ${line.unit}).`,
    options: plan.groups.flatMap((g) =>
      g.lines.map((l) => ({
        supplier: g.supplier,
        chosen: true,
        packs: l.choice.packs,
        pack: l.choice.pack_desc,
        cost: l.choice.cost,
        arrives: l.choice.arrives,
        order_minimum: g.min_order_amount,
        below_minimum_by: g.below_minimum,
        others: l.options.filter((o) => o.supplier_id !== l.choice.supplier_id).map((o) => ({ supplier: o.supplier, packs: o.packs, cost: o.cost, arrives: o.arrives, on_time: o.on_time })),
      })),
    ),
    no_supplier: plan.cant_order.map((n) => n.name),
    order_total: total,
    cash: input.cash
      ? {
          now: input.cash.start,
          after_order: round2(input.cash.start - total),
          reserve: input.cash.reserve,
          lowest_in_14_days_after_order: round2(input.cash.lowest.balance - total),
          stays_above_reserve: input.cash.lowest.balance - total >= input.cash.reserve,
        }
      : null,
  };
}

// ---------- campaign_options ----------

export const ASSUMED_PROMO_LIFT = 1.3; // an assumption, labeled as one wherever it's used
export const MAX_DISCOUNT_USD = 2;

export type SaleLine = { menu_item_id: number; ordered_at: string; qty: number };
export type Offer =
  | { kind: "feature"; label: string }
  | { kind: "drink_bundle"; label: string; drink: string; drink_price: number }
  | { kind: "discount"; label: string; max_usd: number };

// The largest discount (in 50-cent steps, at most $2) that keeps food cost at or under the target.
export function maxDiscount(price: number, unitFoodCost: number): number {
  const room = price - unitFoodCost / TARGET_FOOD_COST;
  return Math.max(0, Math.min(MAX_DISCOUNT_USD, Math.floor(room * 2) / 2));
}

// How many of each dish today's stock could make: the scarcest recipe ingredient decides.
export function dishStockUnits(recipes: { menu_item_id: number; ingredient_id: number; qty: number }[], onHand: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of recipes) {
    if (!(r.qty > 0)) continue;
    const can = Math.max(0, onHand.get(r.ingredient_id) ?? 0) / r.qty;
    out.set(r.menu_item_id, Math.min(out.get(r.menu_item_id) ?? Infinity, can));
  }
  return out;
}

export function campaignOptions(input: {
  days: number;
  daypart?: Daypart;
  now: string; // ISO
  dishes: { id: number; name: string; category: string | null; price: number }[];
  menu: MenuRow[];
  sales: SaleLine[]; // order lines for the last 2 x days
  stockUnits: Map<number, number>; // dish id -> how many today's stock could make
  forecastWeek: Map<number, number>; // dish id -> expected units over the next 7 days
  lastPosted: Map<string, string>; // dish name (lowercase) -> ISO date of the last post
  trends: { dish_name: string; recommend_score: number | null }[];
  lessons?: { action: string; item: string; verdict: string }[]; // Phase 5: what worked before
}) {
  const { days, daypart } = input;
  const nowMs = Date.parse(input.now);
  const splitAt = nowMs - days * 86400_000;
  const startAt = nowMs - 2 * days * 86400_000;
  const units = new Map<number, { cur: number; prev: number; partCur: number; partPrev: number }>();
  for (const s of input.sales) {
    const t = Date.parse(s.ordered_at);
    if (t < startAt || t > nowMs) continue;
    const u = units.get(s.menu_item_id) ?? { cur: 0, prev: 0, partCur: 0, partPrev: 0 };
    const recent = t >= splitAt;
    if (recent) u.cur += s.qty;
    else u.prev += s.qty;
    if (daypart && daypartOf(s.ordered_at) === daypart) {
      if (recent) u.partCur += s.qty;
      else u.partPrev += s.qty;
    }
    units.set(s.menu_item_id, u);
  }
  const pct = (cur: number, prev: number) => (prev > 0 ? round1(((cur - prev) / prev) * 100) : null);
  const byName = new Map(input.menu.map((m) => [key(m.name), m]));
  const drinks = input.dishes.filter((d) => /drink|beverage/i.test(d.category ?? ""));
  const bestDrink = drinks
    .map((d) => ({ d, margin: byName.get(key(d.name))?.unit_margin ?? 0 }))
    .sort((a, b) => b.margin - a.margin)[0]?.d;

  const candidates = input.dishes
    .filter((d) => !drinks.includes(d))
    .map((d) => {
      const row = byName.get(key(d.name));
      const u = units.get(d.id) ?? { cur: 0, prev: 0, partCur: 0, partPrev: 0 };
      const margin = row?.unit_margin ?? null;
      const foodCostPct = row ? row.food_cost_pct : null;
      const promoWeek = round1((input.forecastWeek.get(d.id) ?? 0) * ASSUMED_PROMO_LIFT);
      const canMake = input.stockUnits.get(d.id);
      const cover = canMake === undefined ? null : Math.floor(canMake) >= promoWeek;
      const posted = input.lastPosted.get(key(d.name));
      const daysSincePosted = posted ? Math.floor((nowMs - Date.parse(posted)) / 86400_000) : null;
      // What the dip costs in margin a week: units lost (overall, or in the daypart) x margin
      const lostUnits = daypart ? u.partPrev - u.partCur : u.prev - u.cur;
      const weeklyMarginLost = margin !== null && lostUnits > 0 ? round2(toWeek(lostUnits * margin, days)) : 0;
      const lesson = input.lessons?.find((l) => key(l.item) === key(d.name));
      const bonus = lesson ? (lesson.verdict === "above usual" ? 1.1 : lesson.verdict === "below usual" ? 0.9 : 1) : 1;
      const offers: Offer[] = [{ kind: "feature", label: `Feature ${d.name} in a post, no price change` }];
      if (bestDrink) offers.push({ kind: "drink_bundle", label: `${d.name} with a ${bestDrink.name}`, drink: bestDrink.name, drink_price: bestDrink.price });
      const off = row && row.unit_food_cost !== null ? maxDiscount(d.price, row.unit_food_cost) : 0;
      if (off >= 0.5) offers.push({ kind: "discount", label: `Up to ${money(off)} off (food cost stays at or under ${TARGET_FOOD_COST * 100}%)`, max_usd: off });
      return {
        dish: d.name,
        price: d.price,
        margin_usd: margin,
        food_cost_pct: foodCostPct,
        units_last_period: u.cur,
        units_change_pct: pct(u.cur, u.prev),
        daypart_units: daypart ? u.partCur : undefined,
        daypart_change_pct: daypart ? pct(u.partCur, u.partPrev) : undefined,
        weekly_margin_lost: weeklyMarginLost,
        promo_week_units: promoWeek,
        promo_week_basis: `Next 7 days' forecast x ${ASSUMED_PROMO_LIFT} (an assumed lift, not a measured one).`,
        stock_can_make: canMake === undefined ? null : Math.floor(canMake),
        stock_covers_promo: cover,
        days_since_posted: daysSincePosted,
        last_time: lesson ? `${lesson.action}, ${lesson.verdict}` : undefined,
        offers,
        score: round2((weeklyMarginLost + (margin ?? 0)) * bonus),
      };
    })
    .filter((c) => c.stock_covers_promo !== false && (c.food_cost_pct === null || c.food_cost_pct <= TARGET_FOOD_COST * 100) && (c.days_since_posted === null || c.days_since_posted >= 14))
    .sort((a, b) => b.score - a.score);

  const menuNames = new Set(input.dishes.map((d) => key(d.name)));
  return {
    daypart: daypart ? DAYPARTS[daypart].label : "all day",
    rank_basis: "Weekly margin lost to the dip (units lost x margin), plus the dish's margin, adjusted by what worked before. Skips dishes whose stock can't cover a promo week, whose food cost is over target, or that were posted in the last 14 days.",
    candidates: candidates.slice(0, 6),
    trend_dishes_not_on_menu: input.trends.filter((t) => !menuNames.has(key(t.dish_name))).slice(0, 5),
  };
}
