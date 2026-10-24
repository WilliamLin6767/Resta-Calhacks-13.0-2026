// Accounting on top of Supabase (server only).
//   loadAccounting - delivery-app payouts checked against orders, and unpaid bills
//   markBillPaid   - the owner paid a supplier invoice
//   loadLedger     - money in and out between two dates, for the QuickBooks file
import type { SupabaseClient } from "@supabase/supabase-js";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import { RESTAURANT_ID } from "@/lib/supabase";
import { checkPayouts, groupBills, PLATFORMS, type Bill, type DailySales, type LedgerRow, type Payout, type Platform } from "./reconcile";

type Db = SupabaseClient;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not ${what}: ${res.error.message}`);
  return res.data as T;
}

export function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export async function loadAccounting(db: Db) {
  const today = todayLocal();
  const [daily, payouts, invoices, restaurant] = await Promise.all([
    db.from("v_daily_sales").select("day, channel, revenue, platform_fees").eq("restaurant_id", RESTAURANT_ID).in("channel", Object.keys(PLATFORMS)),
    db.from("platform_payouts").select("*").eq("restaurant_id", RESTAURANT_ID),
    db.from("invoices")
      .select("id, invoice_number, invoice_date, due_date, total, status, suppliers(name), invoice_flags(kind, money_impact, resolved)")
      .eq("restaurant_id", RESTAURANT_ID)
      .neq("status", "paid"),
    db.from("restaurants").select("name").eq("id", RESTAURANT_ID).maybeSingle(),
  ]);
  const checks = checkPayouts(
    must(daily, "load sales") as DailySales[],
    must(payouts, "load payouts (has supabase/07_accounting.sql been run?)") as Payout[],
    today,
  );
  type InvoiceRow = Omit<Bill, "supplier" | "disputed"> & {
    suppliers: { name: string } | null;
    invoice_flags: { kind: string; money_impact: number | null; resolved: boolean }[];
  };
  const bills: Bill[] = (must(invoices, "load bills") as unknown as InvoiceRow[]).map((i) => ({
    id: i.id, invoice_number: i.invoice_number, supplier: i.suppliers?.name ?? "Unknown supplier", invoice_date: i.invoice_date,
    due_date: i.due_date, total: Number(i.total ?? 0), status: i.status,
    disputed: i.invoice_flags.filter((f) => !f.resolved && BILLING_ERROR_KINDS.has(f.kind)).reduce((s, f) => s + Number(f.money_impact ?? 0), 0),
  }));
  return {
    today,
    restaurant: (must(restaurant, "load the restaurant") as { name: string } | null)?.name ?? "our restaurant",
    checks,
    owed: -checks.filter((c) => c.difference < 0).reduce((s, c) => s + c.difference, 0),
    bills: groupBills(bills, today),
  };
}

export async function markBillPaid(db: Db, invoiceId: number) {
  must(
    await db.from("invoices").update({ status: "paid", paid_at: todayLocal() }).eq("id", invoiceId).eq("restaurant_id", RESTAURANT_ID).neq("status", "paid"),
    "mark the bill paid",
  );
}

// Payouts received (money in) and bills paid (money out) from `from` to `to`, inclusive
export async function loadLedger(db: Db, from: string, to: string): Promise<LedgerRow[]> {
  const [payouts, bills] = await Promise.all([
    db.from("platform_payouts").select("platform, paid_on, net_amount").eq("restaurant_id", RESTAURANT_ID).gte("paid_on", from).lte("paid_on", to),
    db.from("invoices").select("paid_at, total, suppliers(name)").eq("restaurant_id", RESTAURANT_ID).eq("status", "paid").gte("paid_at", from).lte("paid_at", to),
  ]);
  const rowsIn = (must(payouts, "load payouts") as { platform: Platform; paid_on: string; net_amount: number }[]).map((p) => ({
    date: p.paid_on, description: `${PLATFORMS[p.platform] ?? p.platform} payout`, amount: Number(p.net_amount),
  }));
  const rowsOut = (must(bills, "load paid bills") as unknown as { paid_at: string; total: number; suppliers: { name: string } | null }[]).map((b) => ({
    date: b.paid_at, description: `${b.suppliers?.name ?? "Supplier"} bill`, amount: -Number(b.total ?? 0),
  }));
  return [...rowsIn, ...rowsOut];
}
