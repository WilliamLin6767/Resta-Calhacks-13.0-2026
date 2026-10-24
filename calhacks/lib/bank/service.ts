// The simulated bank on top of Supabase and Nessie (server only).
//   loadBank     - balance, every payout checked against the bank, and cash after upcoming bills
//   setupBank    - one click: a simulated Nessie account for the demo restaurant, with its payouts deposited
//   setReserve   - how much cash the owner wants to keep in the bank
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORMS, type BillGroup } from "@/lib/accounting/reconcile";
import { loadAccounting } from "@/lib/accounting/service";
import { amountToPay } from "@/lib/purchasing/disputes";
import { RESTAURANT_ID } from "@/lib/supabase";
import { bankChecks, cashAfterBills, type BankCheck, type BankDeposit, type Cash } from "./match";
import { createAccount, createCustomer, createDeposit, getAccount, listDeposits } from "./nessie";

type Db = SupabaseClient;

// The demo story: one DoorDash week where the statement says paid in full but $120 never reached the bank
export const PLANTED_BANK_SHORTFALL = 120;
// The simulated starting balance leaves this much above the reserve after upcoming bills,
// so a typical restock order shows what happens when it would dip into the reserve.
const DEMO_HEADROOM = 600;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

type Link = { nessie_customer_id: string; nessie_account_id: string; cash_reserve: number };

async function loadLink(db: Db): Promise<Link | null> {
  return must(
    await db.from("bank_links").select("nessie_customer_id, nessie_account_id, cash_reserve").eq("restaurant_id", RESTAURANT_ID).maybeSingle(),
    "load the bank link (has supabase/13_bank.sql been run?)",
  ) as Link | null;
}

// Overdue bills plus those due in the next 7 days, after any dispute holdbacks
function billsDue(bills: Record<BillGroup, { total: number; dispute: Parameters<typeof amountToPay>[1] }[]>) {
  return [...bills.overdue, ...bills.due_soon].reduce((s, b) => s + amountToPay(b.total, b.dispute), 0);
}

export type Bank =
  | { connected: false }
  | {
      connected: true;
      account: { nickname: string; last4: string; balance: number };
      cash: Cash;
      checks: BankCheck[];
      problems: BankCheck[];
      owed: number; // from payouts that didn't fully reach the bank
      restaurant: string;
    };

export async function loadBank(db: Db): Promise<Bank> {
  const link = await loadLink(db);
  if (!link) return { connected: false };
  const [account, deposits, links, accounting] = await Promise.all([
    getAccount(link.nessie_account_id),
    listDeposits(link.nessie_account_id),
    db.from("bank_deposit_links").select("payout_id, nessie_deposit_id, amount").eq("restaurant_id", RESTAURANT_ID),
    loadAccounting(db),
  ]);
  const exact = new Map((must(links, "load deposit links") as { payout_id: number; nessie_deposit_id: string; amount: number }[]).map((l) => [l.nessie_deposit_id, l]));
  const bankDeposits: BankDeposit[] = deposits.map((d) => {
    const l = exact.get(d._id);
    return { id: d._id, payout_id: l?.payout_id ?? null, date: d.transaction_date, amount: l ? Number(l.amount) : Number(d.amount), description: d.description ?? "" };
  });
  const checks = bankChecks(accounting.checks, bankDeposits);
  const problems = checks.filter((c) => c.shortfall > 0);
  return {
    connected: true,
    account: { nickname: account.nickname, last4: (account.account_number ?? "").slice(-4), balance: Number(account.balance) },
    cash: cashAfterBills(Number(account.balance), billsDue(accounting.bills), Number(link.cash_reserve)),
    checks,
    problems,
    owed: Math.round(problems.reduce((s, c) => s + c.shortfall, 0) * 100) / 100,
    restaurant: accounting.restaurant,
  };
}

// Creates the simulated account and one deposit per payout statement, once. The latest DoorDash week
// that otherwise matches gets $120 less in the bank than its statement says (the planted demo problem).
export async function setupBank(db: Db) {
  if (await loadLink(db)) return;
  const accounting = await loadAccounting(db);
  const reserve = 1000;
  const balance = billsDue(accounting.bills) + reserve + DEMO_HEADROOM;

  const customer = await createCustomer(accounting.restaurant, "(simulated)");
  const account = await createAccount(customer._id, `${accounting.restaurant} operating account (simulated)`, balance);

  const planted = accounting.checks.find((c) => c.platform === "doordash" && c.status === "ok" && c.payout);
  const rows: { restaurant_id: number; payout_id: number; nessie_deposit_id: string; amount: number }[] = [];
  for (const c of accounting.checks) {
    const p = c.payout;
    if (!p) continue; // no statement (the missing Uber Eats week): nothing arrived either
    const amount = Math.round((Number(p.net_amount) - (c === planted ? PLANTED_BANK_SHORTFALL : 0)) * 100) / 100;
    const d = await createDeposit(account._id, { amount, date: p.paid_on, description: `${PLATFORMS[c.platform]} payout ${p.reference ?? p.period_start}` });
    rows.push({ restaurant_id: RESTAURANT_ID, payout_id: p.id, nessie_deposit_id: d._id, amount });
  }
  if (rows.length) must(await db.from("bank_deposit_links").insert(rows), "save the deposits");
  must(
    await db.from("bank_links").insert({ restaurant_id: RESTAURANT_ID, nessie_customer_id: customer._id, nessie_account_id: account._id, cash_reserve: reserve }),
    "save the bank link",
  );
}

export async function setReserve(db: Db, amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error("Enter a reserve between $0 and $1,000,000.");
  must(await db.from("bank_links").update({ cash_reserve: Math.round(amount * 100) / 100 }).eq("restaurant_id", RESTAURANT_ID), "save the reserve");
}

// Cash after bills, or null when no bank is connected (for the order plan)
export async function loadCash(db: Db): Promise<Cash | null> {
  try {
    const bank = await loadBank(db);
    return bank.connected ? bank.cash : null;
  } catch {
    return null; // the order plan still works without the bank
  }
}
