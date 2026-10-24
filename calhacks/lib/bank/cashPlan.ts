// The cash plan on top of Supabase and Nessie (server only).
//   loadMoney     - 14-day forecast, how much could go to savings, and the food budget
//   moveToSavings - the owner approved a move: a Nessie transfer out and a deposit into savings
//   undoLastMove  - puts the last move back (for trying the demo again)
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORMS } from "@/lib/accounting/reconcile";
import { loadAccounting, todayLocal } from "@/lib/accounting/service";
import type { Digest } from "@/lib/analytics";
import { TARGET_FOOD_COST } from "@/lib/pricing/pricing";
import { amountToPay } from "@/lib/purchasing/disputes";
import { RESTAURANT_ID } from "@/lib/supabase";
import { cashForecast, dailySpend, expectedPayouts, foodBudget, savingsMove, type FoodBudget, type Forecast, type SavingsMove } from "./forecast";
import { createAccount, createDeposit, createTransfer, deleteDeposit, deleteTransfer } from "./nessie";
import { loadBank, loadLink, type Bank } from "./service";

type Db = SupabaseClient;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export type Money = {
  bank: Extract<Bank, { connected: true }>;
  forecast: Forecast;
  move: SavingsMove;
  budget: FoodBudget | null; // null if the analytics digest couldn't be loaded
  ready: boolean; // false until supabase/14_cash.sql is run (no savings moves yet)
};

type OrderRow = { id: number; expected_date: string | null; suppliers: { name: string } | null; purchase_order_lines: { qty: number; est_unit_price: number | null }[] };

export async function loadMoney(db: Db, loaded?: Awaited<ReturnType<typeof loadAccounting>>): Promise<Money | null> {
  const accounting = loaded ?? (await loadAccounting(db));
  const [bank, payouts, orders, invoices, digest] = await Promise.all([
    loadBank(db, accounting),
    db.from("platform_payouts").select("platform, paid_on, net_amount").eq("restaurant_id", RESTAURANT_ID),
    db.from("purchase_orders").select("id, expected_date, suppliers(name), purchase_order_lines(qty, est_unit_price)")
      .eq("restaurant_id", RESTAURANT_ID).in("status", ["approved", "sent"]),
    db.from("invoices").select("invoice_date, total").eq("restaurant_id", RESTAURANT_ID),
    db.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
  ]);
  if (!bank.connected) return null;
  const today = todayLocal();
  const { bills } = accounting;

  const forecast = cashForecast({
    today,
    balance: bank.cash.balance,
    reserve: bank.cash.reserve,
    payouts: expectedPayouts(must(payouts, "load payouts") as { platform: string; paid_on: string; net_amount: number }[], today, PLATFORMS),
    bills: [...bills.overdue, ...bills.due_soon, ...bills.later].map((b) => ({ date: b.due_date, label: `${b.supplier} bill`, amount: amountToPay(b.total, b.dispute) })),
    orders: (must(orders, "load orders") as unknown as OrderRow[]).map((o) => ({
      date: o.expected_date, label: `${o.suppliers?.name ?? "Supplier"} order`,
      amount: o.purchase_order_lines.reduce((s, l) => s + Number(l.qty) * Number(l.est_unit_price ?? 0), 0),
    })).filter((o) => o.amount > 0),
    daily_spend: dailySpend(must(invoices, "load invoices") as { invoice_date: string; total: number }[], today),
  });

  let budget: FoodBudget | null = null;
  if (!digest.error && digest.data) {
    const d = digest.data as Digest;
    budget = foodBudget({
      days: d.period.days, sales: Number(d.kpis.cur?.revenue ?? 0), food_cost: Number(d.kpis.cur?.food_cost ?? 0), target: TARGET_FOOD_COST,
      dishes: d.menu.map((m) => ({ name: m.name, food_cost: Number(m.units) * Number(m.unit_food_cost ?? 0) })),
    });
  }
  return { bank, forecast, move: savingsMove(forecast), budget, ready: bank.savings !== null };
}

export async function moveToSavings(db: Db, amount: number) {
  // Nessie keeps whole dollars only
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Enter a whole-dollar amount to move.");
  const [link, bank] = await Promise.all([loadLink(db), loadBank(db)]);
  if (!link || !bank.connected) throw new Error("Connect the simulated bank account first.");
  if (bank.savings === null) throw new Error("Run supabase/14_cash.sql in Supabase first.");
  if (amount > bank.cash.balance) throw new Error(`Only ${bank.cash.balance.toFixed(2)} is in the account.`);

  let savingsId = link.nessie_savings_id;
  if (!savingsId) {
    const account = await createAccount(link.nessie_customer_id, `${bank.restaurant} savings (simulated)`, 0, "Savings");
    savingsId = account._id;
    must(await db.from("bank_links").update({ nessie_savings_id: savingsId }).eq("restaurant_id", RESTAURANT_ID), "save the savings account");
  }
  const date = todayLocal();
  const transfer = await createTransfer(link.nessie_account_id, { amount, date, description: "Move to savings" });
  const deposit = await createDeposit(savingsId, { amount, date, description: "From the operating account" });
  must(
    await db.from("bank_transfers").insert({ restaurant_id: RESTAURANT_ID, nessie_transfer_id: transfer._id, nessie_deposit_id: deposit._id, amount }),
    "save the transfer",
  );
}

export async function undoLastMove(db: Db) {
  const rows = must(
    await db.from("bank_transfers").select("id, nessie_transfer_id, nessie_deposit_id").eq("restaurant_id", RESTAURANT_ID).order("created_at", { ascending: false }).limit(1),
    "load the last move",
  ) as { id: number; nessie_transfer_id: string; nessie_deposit_id: string }[];
  const last = rows[0];
  if (!last) throw new Error("Nothing has been moved to savings.");
  await Promise.all([deleteTransfer(last.nessie_transfer_id), deleteDeposit(last.nessie_deposit_id)]);
  must(await db.from("bank_transfers").delete().eq("id", last.id), "undo the move");
}
