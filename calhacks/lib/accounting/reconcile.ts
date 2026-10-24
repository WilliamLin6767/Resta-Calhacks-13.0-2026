// Accounting (A6): did the delivery apps pay what they owe, which bills are due, and a QuickBooks file.
// Pure functions, no database calls and no AI.

export const PLATFORMS = { doordash: "DoorDash", ubereats: "Uber Eats" } as const;
export type Platform = keyof typeof PLATFORMS;
// Apps pay each week (Monday-Sunday) a few days after it ends. A payout counts as missing after this many days.
export const PAYOUT_GRACE_DAYS = 5;
// Differences under a dollar are rounding.
const TOLERANCE = 1;

export type DailySales = { day: string; channel: string; revenue: number; platform_fees: number };
export type Payout = {
  id: number; platform: string; period_start: string; period_end: string; paid_on: string;
  gross_sales: number; fees: number; adjustments: number; net_amount: number; reference: string | null; note: string | null;
};
export type PayoutCheck = {
  platform: Platform;
  period_start: string;
  period_end: string;
  expected_gross: number; // from our own orders
  expected_fees: number;
  expected_net: number;
  payout: Payout | null;
  difference: number; // paid - expected (negative = they owe us)
  status: "ok" | "short" | "over" | "missing" | "pending";
  message: string;
};

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The Monday on or before `day`
export function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

function money(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// One row per app per finished week: what our orders say the payout should be vs. what was paid.
// Weeks still in progress are left out.
export function checkPayouts(daily: DailySales[], payouts: Payout[], today: string): PayoutCheck[] {
  const expected = new Map<string, { gross: number; fees: number }>();
  for (const d of daily) {
    if (!(d.channel in PLATFORMS)) continue;
    const key = `${d.channel}:${weekStart(d.day)}`;
    const e = expected.get(key) ?? { gross: 0, fees: 0 };
    e.gross += Number(d.revenue);
    e.fees += Number(d.platform_fees);
    expected.set(key, e);
  }
  const paid = new Map(payouts.map((p) => [`${p.platform}:${p.period_start}`, p]));

  const checks: PayoutCheck[] = [];
  for (const [key, e] of expected) {
    const [platform, start] = key.split(":") as [Platform, string];
    const end = addDays(start, 6);
    if (end >= today) continue; // week not over
    const p = paid.get(key) ?? null;
    const expectedNet = round2(e.gross - e.fees);
    const name = PLATFORMS[platform];
    let status: PayoutCheck["status"];
    let message: string;
    let difference = 0;
    if (!p) {
      const overdue = addDays(end, PAYOUT_GRACE_DAYS) < today;
      status = overdue ? "missing" : "pending";
      difference = overdue ? -expectedNet : 0;
      message = overdue ? `No ${name} payout for this week. Your orders say it should be ${money(expectedNet)}.` : "Payout not due yet.";
    } else {
      difference = round2(Number(p.net_amount) - expectedNet);
      if (Math.abs(difference) < TOLERANCE) {
        status = "ok";
        message = "Matches your orders.";
      } else {
        status = difference < 0 ? "short" : "over";
        const why = [
          Math.abs(Number(p.gross_sales) - e.gross) >= TOLERANCE ? `${name} reports ${money(Number(p.gross_sales))} in sales, your orders add up to ${money(e.gross)}` : "",
          Math.abs(Number(p.fees) - e.fees) >= TOLERANCE ? `fees of ${money(Number(p.fees))} instead of ${money(e.fees)}` : "",
          Number(p.adjustments) ? `an adjustment of ${Number(p.adjustments) < 0 ? "-" : "+"}${money(Number(p.adjustments))}${p.note ? ` (${p.note})` : ""}` : "",
        ].filter(Boolean);
        message = `Paid ${money(Number(p.net_amount))}, ${money(difference)} ${difference < 0 ? "less" : "more"} than your orders say${why.length ? `: ${why.join("; ")}` : ""}.`;
      }
    }
    checks.push({
      platform, period_start: start, period_end: end, expected_gross: round2(e.gross), expected_fees: round2(e.fees), expected_net: expectedNet,
      payout: p, difference, status, message,
    });
  }
  return checks.sort((a, b) => b.period_start.localeCompare(a.period_start) || a.platform.localeCompare(b.platform));
}

// A note the owner can send the app's merchant support
export function payoutDispute(c: PayoutCheck, restaurant: string): string {
  const week = `${c.period_start} to ${c.period_end}`;
  if (c.status === "missing") {
    return `Hello, this is ${restaurant}. We have not received a payout for ${week}. Our orders for that week total ${money(c.expected_gross)} with ${money(c.expected_fees)} in fees, so we expect ${money(c.expected_net)}. Please send it or tell us when it will arrive. Thank you.`;
  }
  return `Hello, this is ${restaurant}. Our payout for ${week}${c.payout?.reference ? ` (${c.payout.reference})` : ""} was ${money(Number(c.payout?.net_amount ?? 0))}, but our orders show ${money(c.expected_net)} after fees, ${money(c.difference)} less.${c.payout?.note ? ` The statement says: "${c.payout.note}".` : ""} Please review it and refund the difference. Thank you.`;
}

export type Bill = {
  id: number; invoice_number: string | null; supplier: string; invoice_date: string; due_date: string | null;
  total: number; status: string; disputed: number; // open billing errors found on it (A1)
};
export type BillGroup = "overdue" | "due_soon" | "later";

// Unpaid bills by when they're due: overdue, due in the next 7 days, later
export function groupBills(bills: Bill[], today: string): Record<BillGroup, Bill[]> {
  const groups: Record<BillGroup, Bill[]> = { overdue: [], due_soon: [], later: [] };
  for (const b of [...bills].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))) {
    if (b.due_date && b.due_date < today) groups.overdue.push(b);
    else if (b.due_date && b.due_date <= addDays(today, 7)) groups.due_soon.push(b);
    else groups.later.push(b);
  }
  return groups;
}

export type LedgerRow = { date: string; description: string; amount: number };

// QuickBooks Online's 3-column bank-transaction CSV: Date, Description, Amount, with deposits positive and
// payments negative. Intuit's guide says descriptions shouldn't contain numbers, so they're names only.
export function quickbooksCsv(rows: LedgerRow[]): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const usDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  const lines = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => [usDate(r.date), cell(r.description.replace(/\d/g, "").replace(/\s+/g, " ").trim()), r.amount.toFixed(2)].join(","));
  return ["Date,Description,Amount", ...lines].join("\r\n") + "\r\n";
}
