// Measuring a case after its window (pure). The goal metric and its baseline are computed in
// code, the verdict wording is fixed here, and the report never claims cause: an association,
// not proof.
import { daypartOf, localTime, type Daypart } from "@/lib/agent/investigate";
import type { Goal, Lesson, Verdict } from "./types";

export const MIN_DAYS = 7; // fewer days in the window: too early to tell
export const MIN_ORDERS = 30; // fewer orders behind a sales metric: too early to tell
export const SAME_BAND = 0.05; // within 5% of the baseline counts as about the same

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400_000;

// ---------- The verdict ----------

export function verdictFor(m: { value: number | null; baseline: number | null; direction: Goal["direction"]; days: number; orders: number; needsOrders: boolean }): Verdict {
  if (m.days < MIN_DAYS || (m.needsOrders && m.orders < MIN_ORDERS) || m.value === null || m.baseline === null) return "too early to tell";
  const base = Math.abs(m.baseline) > 1e-9 ? m.baseline : null;
  const change = base === null ? m.value - m.baseline : (m.value - m.baseline) / Math.abs(base);
  const band = base === null ? 0 : SAME_BAND;
  if (Math.abs(change) <= band) return "about the same";
  const better = m.direction === "up" ? change > 0 : change < 0;
  return better ? "above usual" : "below usual";
}

// "above usual" means better than usual in the goal's direction (lower cost, more sales, fewer stockouts)
const MEANING: Record<Verdict, string> = {
  "above usual": "better than usual",
  "about the same": "about the same as usual",
  "below usual": "worse than usual",
  "too early to tell": "too early to tell",
};

const num = (n: number | null, unit: string) => (n === null ? "unknown" : unit === "$" ? `$${n.toFixed(2)}` : `${round2(n)} ${unit}`);

// The report for the owner. Fixed wording; never "caused" or "because of".
export function reportFor(r: {
  title: string; action: string; goal: Goal; value: number | null; baseline: number | null; baselineMethod: string;
  sample: { days: number; orders: number }; cost: number; verdict: Verdict;
}): string {
  const lines = [
    `${r.title}. What was done: ${r.action}.`,
    `${r.goal.label}: ${num(r.value, r.goal.unit)} in the ${r.sample.days} days measured, against ${num(r.baseline, r.goal.unit)} (${r.baselineMethod}).`,
    `Verdict: ${r.verdict} (${MEANING[r.verdict]}).`,
    `Sample: ${r.sample.days} days${r.sample.orders ? `, ${r.sample.orders} orders` : ""}.${r.cost > 0 ? ` Cost: $${r.cost.toFixed(2)}.` : ""}`,
    r.verdict === "too early to tell"
      ? `There isn't enough data yet (at least ${MIN_DAYS} days${r.sample.orders || r.goal.unit === "plates a day" ? ` and ${MIN_ORDERS} orders` : ""} are needed).`
      : "This is an association, not proof: other things changed in the same weeks.",
  ];
  return lines.join(" ");
}

export function lessonFor(playbook: string, action: string, item: string, verdict: Verdict, value: number | null, baseline: number | null): Lesson {
  return { playbook, action, item, verdict, difference: value !== null && baseline !== null ? round2(value - baseline) : null };
}

// ---------- Metrics ----------

export type SaleLine = { menu_item_id: number; ordered_at: string; qty: number; unit_price: number; order_id?: number };

// Each day in [start, end) as a Pacific date, and the same weekdays in the 4 weeks before start.
function daysIn(startMs: number, endMs: number) {
  const out: string[] = [];
  for (let t = startMs; t < endMs; t += DAY) out.push(localTime(new Date(t).toISOString()).day);
  return [...new Set(out)];
}

// Plates of one dish a day (in a daypart, if given) over the window, against the same weekdays
// in the 4 weeks before it. Only days the restaurant had orders count. Also the daypart's revenue.
export function dishDaypartMetric(lines: SaleLine[], dishId: number, daypart: Daypart | null, windowStart: string, windowEnd: string) {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  const windowDays = new Set(daysIn(start, end));
  const baseDays = new Set([...windowDays].flatMap((d) => [7, 14, 21, 28].map((k) => new Date(Date.parse(`${d}T12:00:00Z`) - k * DAY).toISOString().slice(0, 10))));
  const open = { win: new Set<string>(), base: new Set<string>() };
  const units = { win: 0, base: 0 };
  const revenue = { win: 0, base: 0 };
  const orders = new Set<string>();
  for (const l of lines) {
    const { day } = localTime(l.ordered_at);
    const side = windowDays.has(day) ? "win" : baseDays.has(day) ? "base" : null;
    if (!side) continue;
    open[side].add(day);
    if (daypart && daypartOf(l.ordered_at) !== daypart) continue;
    revenue[side] += l.qty * l.unit_price;
    if (l.menu_item_id === dishId) {
      units[side] += l.qty;
      if (side === "win") orders.add(String(l.order_id ?? `${l.ordered_at}:${l.menu_item_id}`));
    }
  }
  const perDay = (n: number, days: number) => (days > 0 ? round2(n / days) : null);
  return {
    value: perDay(units.win, open.win.size),
    baseline: perDay(units.base, open.base.size),
    revenue_per_day: perDay(revenue.win, open.win.size),
    baseline_revenue_per_day: perDay(revenue.base, open.base.size),
    units: units.win,
    days: open.win.size,
    orders: orders.size,
  };
}

// The average unit cost on invoices dated in the window, against the invoices before it.
export function unitCostMetric(lines: { invoice_date: string; unit_price: number; pack_qty: number | null }[], windowStart: string, windowEnd: string) {
  const unit = (l: (typeof lines)[number]) => (l.pack_qty && l.pack_qty > 0 ? l.unit_price / l.pack_qty : l.unit_price);
  const start = windowStart.slice(0, 10);
  const end = windowEnd.slice(0, 10);
  const win = lines.filter((l) => l.invoice_date >= start && l.invoice_date < end);
  const before = lines.filter((l) => l.invoice_date < start).sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).slice(0, 3);
  const avg = (xs: typeof lines) => (xs.length ? round2(xs.reduce((s, l) => s + unit(l), 0) / xs.length) : null);
  return { value: avg(win), baseline: avg(before), invoices: win.length };
}

// Days in the window when the ingredient's stock was recorded at zero or below.
export function stockoutDays(events: { created_at: string; qty_after: number }[], windowStart: string, windowEnd: string) {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  return new Set(events.filter((e) => Date.parse(e.created_at) >= start && Date.parse(e.created_at) < end && Number(e.qty_after) <= 0).map((e) => localTime(e.created_at).day)).size;
}
