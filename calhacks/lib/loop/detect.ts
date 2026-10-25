// Finding problems in code (pure). Each detector takes loaded data and returns what it found,
// with facts and a weekly dollar figure, or nothing.
import { DAYPARTS, localTime, type Daypart } from "@/lib/agent/investigate";
import type { Digest } from "@/lib/analytics";
import { priceRiseImpact } from "@/lib/attention/impact";
import type { StockLine } from "@/lib/inventory/stock";
import { judgePriceJump } from "@/lib/market/judge";
import type { SaleLine } from "./measure";
import type { Detected } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY = 86400_000;
const money = (n: number) => `$${n.toFixed(2)}`;

// ---------- Sales dip: revenue per open day by daypart, last 14 days vs the 28 before ----------

export const DIP_MIN_PCT = 10;
export const DIP_MIN_USD_WEEK = 50;
export const RECENT_DAYS = 14;
export const PRIOR_DAYS = 28;

type Segment = { daypart: Daypart; weekend: boolean };
const SEGMENTS: Segment[] = (Object.keys(DAYPARTS) as Daypart[]).flatMap((daypart) => [{ daypart, weekend: false }, { daypart, weekend: true }]);
const segName = (s: Segment) => `${s.weekend ? "weekend" : "weekday"} ${s.daypart}`;

export function detectSalesDips(lines: SaleLine[], dishes: { id: number; name: string }[], now: string): Detected[] {
  const nowMs = Date.parse(now);
  const recentFrom = nowMs - RECENT_DAYS * DAY;
  const priorFrom = recentFrom - PRIOR_DAYS * DAY;
  const name = new Map(dishes.map((d) => [d.id, d.name]));
  const out: Detected[] = [];

  for (const seg of SEGMENTS) {
    const open = { recent: new Set<string>(), prior: new Set<string>() };
    const revenue = { recent: 0, prior: 0 };
    const units = { recent: new Map<number, number>(), prior: new Map<number, number>() };
    for (const l of lines) {
      const t = Date.parse(l.ordered_at);
      if (t < priorFrom || t >= nowMs) continue;
      const side = t >= recentFrom ? "recent" : "prior";
      const local = localTime(l.ordered_at);
      if (local.weekend !== seg.weekend) continue;
      open[side].add(local.day); // a day the restaurant had orders in this kind of day
      const part = DAYPARTS[seg.daypart];
      if (local.minutes < part.from || local.minutes >= part.to) continue;
      revenue[side] += l.qty * l.unit_price;
      units[side].set(l.menu_item_id, (units[side].get(l.menu_item_id) ?? 0) + l.qty);
    }
    if (!open.recent.size || !open.prior.size) continue;
    const recentPerDay = revenue.recent / open.recent.size;
    const priorPerDay = revenue.prior / open.prior.size;
    if (priorPerDay <= 0) continue;
    const dropPct = ((priorPerDay - recentPerDay) / priorPerDay) * 100;
    const daysPerWeek = (open.recent.size / RECENT_DAYS) * 7;
    const weekly = (priorPerDay - recentPerDay) * daysPerWeek;
    if (dropPct < DIP_MIN_PCT || weekly < DIP_MIN_USD_WEEK) continue;

    // The dishes that fell most (plates per open day)
    const dishDrops = [...new Set([...units.prior.keys(), ...units.recent.keys()])]
      .map((id) => {
        const before = (units.prior.get(id) ?? 0) / open.prior.size;
        const nowPer = (units.recent.get(id) ?? 0) / open.recent.size;
        return { id, dish: name.get(id) ?? `Dish ${id}`, before: round1(before), now: round1(nowPer), drop: round1(before - nowPer) };
      })
      .filter((d) => d.drop > 0)
      .sort((a, b) => b.drop - a.drop)
      .slice(0, 3);

    out.push({
      finding_key: `sales-dip:${seg.daypart}:${seg.weekend ? "weekend" : "weekday"}`,
      title: `${segName(seg)[0].toUpperCase()}${segName(seg).slice(1)} revenue is down ${Math.round(dropPct)}%`,
      facts: {
        daypart: seg.daypart, weekend: seg.weekend, drop_pct: round1(dropPct),
        recent_per_open_day: round2(recentPerDay), prior_per_open_day: round2(priorPerDay),
        recent_open_days: open.recent.size, prior_open_days: open.prior.size, dishes_down: dishDrops,
      },
      evidence: [
        { label: `Last ${RECENT_DAYS} days`, value: `${money(recentPerDay)} per open day (${open.recent.size} days)` },
        { label: `The ${PRIOR_DAYS} days before`, value: `${money(priorPerDay)} per open day (${open.prior.size} days)` },
        ...dishDrops.map((d) => ({ label: d.dish, value: `${d.before} to ${d.now} plates a day` })),
      ],
      impact_usd_week: round2(weekly),
      basis: `(${money(priorPerDay)} - ${money(recentPerDay)}) per open day x ${round1(daysPerWeek)} open days a week.`,
    });
  }
  return out;
}

// ---------- Supplier price rise ----------

export const RISE_MIN_PCT = 5;

export function detectPriceRises(
  changes: Digest["price_changes"],
  lines: StockLine[],
  marketPct: (ingredient: string) => number | null,
): Detected[] {
  return changes.flatMap((c): Detected[] => {
    if (!c.is_current_supplier || !(c.change_pct >= RISE_MIN_PCT) || c.current_unit_cost === null || !c.previous_price || !c.current_price) return [];
    const line = lines.find((l) => l.name.trim().toLowerCase() === c.ingredient.trim().toLowerCase());
    if (!line || !(line.daily_use > 0)) return [];
    const oldUnit = (c.current_unit_cost * c.previous_price) / c.current_price;
    const impact = priceRiseImpact(c.current_unit_cost, oldUnit, line.daily_use * 7, line.unit);
    const verdict = judgePriceJump(c.change_pct, marketPct(c.ingredient));
    return [{
      finding_key: `price-rise:${line.id}`,
      title: `${c.supplier} raised ${c.ingredient.toLowerCase()} ${c.change_pct}%`,
      facts: {
        ingredient: c.ingredient, ingredient_id: line.id, supplier: c.supplier, change_pct: c.change_pct, since: c.since,
        previous_price: c.previous_price, current_price: c.current_price, unit_cost_now: c.current_unit_cost, unit_cost_before: round2(oldUnit),
        weekly_use: round1(line.daily_use * 7), unit: line.unit, cheapest_supplier: c.cheapest_supplier, cheapest_unit_cost: c.cheapest_unit_cost,
        market_verdict: verdict.kind, market_label: verdict.label,
      },
      evidence: [
        { label: "Price", value: `${money(c.previous_price)} to ${money(c.current_price)} since ${c.since}`, href: "/suppliers" },
        { label: "Market check", value: verdict.label },
        ...(c.cheapest_supplier && c.cheapest_unit_cost !== null ? [{ label: "Cheaper", value: `${c.cheapest_supplier} at ${money(c.cheapest_unit_cost)}/${line.unit}` }] : []),
      ],
      impact_usd_week: impact.impact_usd_week,
      basis: impact.basis,
    }];
  });
}

// ---------- Stockout risk: days left below the supplier's lead time ----------

// impactFor: what running short costs (lib/attention/impact.ts stockoutImpact), when known
export function detectStockouts(
  lines: StockLine[],
  leadDays: (ingredientId: number) => number,
  impactFor?: (ingredientId: number, daysShort: number) => { impact_usd_week: number | null; basis: string },
): Detected[] {
  return lines.flatMap((l): Detected[] => {
    if (l.days_left === null || !(l.daily_use > 0)) return [];
    const lead = leadDays(l.id);
    if (l.days_left >= lead) return [];
    const cost = impactFor?.(l.id, round1(lead - l.days_left));
    return [{
      finding_key: `stockout:${l.id}`,
      title: `${l.name} runs out before a delivery can arrive`,
      facts: { ingredient: l.name, ingredient_id: l.id, on_hand: l.estimated, unit: l.unit, daily_use: l.daily_use, days_left: l.days_left, lead_days: lead, days_short: round1(lead - l.days_left) },
      evidence: [
        { label: "On hand", value: `${l.estimated} ${l.unit}, about ${l.days_left} days`, href: "/inventory" },
        { label: "Delivery takes", value: `${lead} day${lead === 1 ? "" : "s"}` },
      ],
      impact_usd_week: cost?.impact_usd_week ?? null,
      basis: cost?.impact_usd_week != null ? cost.basis : `${l.days_left} days of stock left, and the supplier needs ${lead}.`,
    }];
  });
}
