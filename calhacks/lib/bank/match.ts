// Bank check: three separate sources for each delivery-app payout, and cash after upcoming bills.
// Pure functions, no database or API calls and no AI.
//   1. what our own orders say the app owes (lib/accounting/reconcile.ts)
//   2. what the app's payout statement says it paid
//   3. what actually reached the bank (Nessie deposits)

import type { PayoutCheck } from "@/lib/accounting/reconcile";

// The bank keeps whole dollars only, so a dollar either way still counts as the same amount
export const BANK_TOLERANCE = 1;

export type BankDeposit = { id: string; payout_id: number | null; date: string; amount: number; description: string };

export type BankCheck = {
  week: PayoutCheck;
  deposit: BankDeposit | null;
  status: "matched" | "app_paid_short" | "bank_short" | "no_deposit" | "missing_payout" | "not_due";
  shortfall: number; // dollars the restaurant is still owed, compared with its own orders
  message: string;
};

function money(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Finds each payout's deposit: the one we linked when it was recorded, else one with the payout's
// reference in its description, else the same amount within 5 days of the payout date.
export function bankChecks(weeks: PayoutCheck[], deposits: BankDeposit[]): BankCheck[] {
  const used = new Set<string>();
  const find = (w: PayoutCheck): BankDeposit | null => {
    const p = w.payout;
    if (!p) return null;
    const free = deposits.filter((d) => !used.has(d.id));
    const days = (d: BankDeposit) => Math.abs(Date.parse(d.date) - Date.parse(p.paid_on)) / 86400_000;
    return (
      free.find((d) => d.payout_id === p.id) ??
      (p.reference ? free.find((d) => d.description.includes(p.reference!)) : undefined) ??
      free.find((d) => Math.abs(d.amount - Number(p.net_amount)) < BANK_TOLERANCE && days(d) <= 5) ??
      null
    );
  };

  return weeks.map((w) => {
    if (w.status === "pending") return { week: w, deposit: null, status: "not_due", shortfall: 0, message: "Payout not due yet." };
    const deposit = find(w);
    if (deposit) used.add(deposit.id);
    const reported = w.payout ? Number(w.payout.net_amount) : 0;

    if (!w.payout) {
      return {
        week: w, deposit, status: deposit ? "matched" : "missing_payout", shortfall: deposit ? 0 : w.expected_net,
        message: deposit ? "No statement, but the money arrived." : `No statement and nothing in the bank. Your orders say ${money(w.expected_net)} is owed.`,
      };
    }
    if (!deposit) {
      return {
        week: w, deposit: null, status: "no_deposit", shortfall: w.expected_net,
        message: `The statement says ${money(reported)} was paid, but no matching deposit reached the bank.`,
      };
    }
    if (deposit.amount < reported - BANK_TOLERANCE) {
      return {
        week: w, deposit, status: "bank_short", shortfall: Math.round((w.expected_net - deposit.amount) * 100) / 100,
        message: `The statement says ${money(reported)}, but only ${money(deposit.amount)} reached the bank: ${money(reported - deposit.amount)} missing.`,
      };
    }
    if (w.status === "short") {
      return { week: w, deposit, status: "app_paid_short", shortfall: -w.difference, message: `The bank got what the statement says, but the app paid short. ${w.message}` };
    }
    return { week: w, deposit, status: "matched", shortfall: 0, message: "Orders, statement and bank all agree." };
  });
}

export type Cash = {
  balance: number; // in the bank now
  bills_due: number; // overdue plus due in the next 7 days, after any dispute holdbacks
  after_bills: number;
  reserve: number; // what the owner wants to keep in the bank at all times
  spare: number; // after bills, above the reserve (negative = already below it)
};

export function cashAfterBills(balance: number, billsDue: number, reserve: number): Cash {
  const after = Math.round((balance - billsDue) * 100) / 100;
  return { balance, bills_due: Math.round(billsDue * 100) / 100, after_bills: after, reserve, spare: Math.round((after - reserve) * 100) / 100 };
}

// What an order does to cash: what's left after bills and the order, and how far below the reserve
export function orderImpact(cash: Cash, orderTotal: number) {
  const left = Math.round((cash.after_bills - orderTotal) * 100) / 100;
  return { left, below_reserve: Math.max(0, Math.round((cash.reserve - left) * 100) / 100) };
}

// A note for the delivery app's support when money didn't reach the bank
export function bankNote(c: BankCheck, restaurant: string, last4: string) {
  const week = `${c.week.period_start} to ${c.week.period_end}`;
  const ref = c.week.payout?.reference ? ` (${c.week.payout.reference})` : "";
  if (c.status === "bank_short" && c.deposit) {
    return `Hello, this is ${restaurant}. Your payout statement for ${week}${ref} shows ${money(Number(c.week.payout?.net_amount ?? 0))} paid, but only ${money(c.deposit.amount)} was deposited to our account ending ${last4} on ${c.deposit.date}. Please send the missing ${money(Number(c.week.payout?.net_amount ?? 0) - c.deposit.amount)} or tell us where it went. Thank you.`;
  }
  return `Hello, this is ${restaurant}. Your payout statement for ${week}${ref} shows ${money(Number(c.week.payout?.net_amount ?? 0))} paid, but no deposit reached our account ending ${last4}. Please check the transfer and tell us when it will arrive. Thank you.`;
}
