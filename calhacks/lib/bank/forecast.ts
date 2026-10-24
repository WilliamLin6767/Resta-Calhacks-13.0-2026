// Cash plan for the simulated supplies account (delivery payouts in, supplier bills out).
// Pure functions, no database or API calls and no AI. This is cash management, not investment advice:
// the numbers come from here, the AI only explains them, and the owner decides.
//   cashForecast  - the next 14 days, day by day: payouts in, bills and orders out
//   savingsMove   - how much can sit in savings without the forecast dipping below the reserve
//   foodBudget    - food used in the last 30 days against the food cost target

import { addDays } from "@/lib/accounting/reconcile";

export const FORECAST_DAYS = 14;
// A move to savings keeps this share of the spare cash in the account, in case the estimate is off
export const SAVINGS_CUSHION = 0.2;
// Smaller moves aren't worth suggesting
export const MIN_SAVINGS_MOVE = 100;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PastPayout = { platform: string; paid_on: string; net_amount: number };
export type Flow = { date: string | null; label: string; amount: number }; // amount > 0; date null = as soon as possible

export type ForecastEvent = { label: string; amount: number }; // + money in, - money out
export type ForecastDay = { date: string; balance: number; events: ForecastEvent[] };
export type Forecast = {
  start: number;
  reserve: number;
  daily_spend: number; // usual supplier spend per day, on top of the known bills and orders
  days: ForecastDay[];
  lowest: { date: string; balance: number };
  first_below: string | null; // first day under the reserve
  money_in: number;
  money_out: number;
};

// The next payouts for each app: one a week after its last one, at the average of its last 4.
// A payout that is already late isn't counted on, since it may not come.
export function expectedPayouts(past: PastPayout[], today: string, names: Record<string, string>, days = FORECAST_DAYS): Flow[] {
  const end = addDays(today, days - 1);
  const flows: Flow[] = [];
  for (const platform of new Set(past.map((p) => p.platform))) {
    const mine = past.filter((p) => p.platform === platform).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
    const recent = mine.slice(0, 4);
    const amount = round2(recent.reduce((s, p) => s + Number(p.net_amount), 0) / recent.length);
    for (let d = addDays(mine[0].paid_on, 7); d <= end; d = addDays(d, 7)) {
      if (d >= today) flows.push({ date: d, label: `${names[platform] ?? platform} payout (estimate)`, amount });
    }
  }
  return flows;
}

// Day by day from today. Bills land on their due date (overdue ones today), orders on their delivery
// date, and the usual supplier spend comes out every day on top: a conservative guess.
export function cashForecast(input: {
  today: string;
  balance: number;
  reserve: number;
  payouts: Flow[];
  bills: Flow[];
  orders: Flow[];
  daily_spend: number;
  days?: number;
}): Forecast {
  const n = input.days ?? FORECAST_DAYS;
  const when = (f: Flow) => (f.date && f.date > input.today ? f.date : input.today);
  const byDay = new Map<string, ForecastEvent[]>();
  const add = (date: string, e: ForecastEvent) => byDay.set(date, [...(byDay.get(date) ?? []), e]);
  for (const f of input.payouts) add(when(f), { label: f.label, amount: f.amount });
  for (const f of [...input.bills, ...input.orders]) add(when(f), { label: f.label, amount: -f.amount });

  let balance = input.balance;
  let moneyIn = 0;
  let moneyOut = 0;
  const days: ForecastDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(input.today, i);
    const events = byDay.get(date) ?? [];
    const flows = [...events.map((e) => e.amount), -input.daily_spend];
    for (const a of flows) {
      if (a > 0) moneyIn += a;
      else moneyOut -= a;
    }
    balance = round2(balance + flows.reduce((s, a) => s + a, 0));
    days.push({ date, balance, events });
  }
  const lowest = days.reduce((lo, d) => (d.balance < lo.balance ? d : lo), days[0]);
  return {
    start: input.balance, reserve: input.reserve, daily_spend: round2(input.daily_spend), days,
    lowest: { date: lowest.date, balance: lowest.balance },
    first_below: days.find((d) => d.balance < input.reserve)?.date ?? null,
    money_in: round2(moneyIn), money_out: round2(moneyOut),
  };
}

// Average supplier spend per day over the last `days` days, from the invoices' totals
export function dailySpend(invoices: { invoice_date: string; total: number }[], today: string, days = 42) {
  const from = addDays(today, -days);
  return round2(invoices.filter((i) => i.invoice_date >= from && i.invoice_date < today).reduce((s, i) => s + Number(i.total), 0) / days);
}

const roundDown50 = (n: number) => Math.floor(n / 50) * 50;

export type SavingsMove =
  | { kind: "now"; amount: number; lowest_after: number } // safe to move today
  | { kind: "later"; date: string; amount: number } // safe once that day's payouts land
  | { kind: "none" };

// Money moved today lowers every day of the forecast by the same amount, so the most that can go
// is what the lowest day has above the reserve, less a cushion. If nothing can go today, the same
// check from the next payout day on.
export function savingsMove(f: Forecast): SavingsMove {
  const spareFrom = (i: number) => Math.min(...f.days.slice(i).map((d) => d.balance)) - f.reserve;
  const amount = (spare: number) => roundDown50(spare * (1 - SAVINGS_CUSHION));
  const now = amount(spareFrom(0));
  if (now >= MIN_SAVINGS_MOVE) return { kind: "now", amount: now, lowest_after: round2(f.lowest.balance - now) };
  const i = f.days.findIndex((d) => d.events.some((e) => e.amount > 0));
  if (i > 0) {
    const later = amount(spareFrom(i));
    if (later >= MIN_SAVINGS_MOVE) return { kind: "later", date: f.days[i].date, amount: later };
  }
  return { kind: "none" };
}

export type DishCost = { name: string; food_cost: number };
export type FoodBudget = {
  days: number;
  sales: number;
  target_pct: number; // e.g. 30
  budget: number; // target share of sales
  used: number; // what the food sold cost, from recipes at the prices paid
  pct: number;
  left: number; // budget - used (negative = over)
  top: (DishCost & { share: number })[]; // where most of the food money went
};

export function foodBudget(input: { days: number; sales: number; food_cost: number; target: number; dishes: DishCost[] }): FoodBudget {
  const budget = round2(input.sales * input.target);
  const used = round2(input.food_cost);
  return {
    days: input.days, sales: round2(input.sales), target_pct: Math.round(input.target * 100), budget, used,
    pct: input.sales > 0 ? Math.round((1000 * used) / input.sales) / 10 : 0,
    left: round2(budget - used),
    top: [...input.dishes].sort((a, b) => b.food_cost - a.food_cost).slice(0, 3)
      .map((d) => ({ ...d, food_cost: round2(d.food_cost), share: used > 0 ? Math.round((100 * d.food_cost) / used) : 0 })),
  };
}
