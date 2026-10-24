import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import { addDays, payoutDispute, PLATFORMS, type Bill, type BillGroup } from "@/lib/accounting/reconcile";
import { loadAccounting } from "@/lib/accounting/service";
import { formatMoney } from "@/lib/format";
import { amountToPay } from "@/lib/purchasing/disputes";
import { getSupabase } from "@/lib/supabase";
import { CopyNote, MarkPaid, QuickbooksExport } from "./AccountingActions";

const STATUS: Record<string, { label: string; className: string }> = {
  ok: { label: "Matches", className: "text-green-700" },
  short: { label: "Paid less", className: "text-red-700" },
  over: { label: "Paid more", className: "text-amber-700" },
  missing: { label: "Missing", className: "text-red-700" },
  pending: { label: "Not due yet", className: "text-gray-500" },
};

const GROUPS: { key: BillGroup; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "due_soon", title: "Due in the next 7 days" },
  { key: "later", title: "Later" },
];

// What to do about billing errors on a bill, from its dispute (A1) if there is one
function BillDispute({ bill: b }: { bill: Bill }) {
  const pay = formatMoney(amountToPay(b.total, b.dispute));
  if (b.dispute?.status === "sent" || b.dispute?.status === "draft") {
    const what = b.dispute.status === "sent" ? "Dispute sent" : "Dispute email drafted, not sent";
    return <span className="ml-2 text-amber-800">{what}: hold back {formatMoney(b.dispute.amount_claimed)}, pay {pay}</span>;
  }
  if (b.dispute?.status === "credited") return <span className="ml-2 text-green-700">Credit of {formatMoney(b.dispute.amount_credited ?? 0)} received: pay {pay}</span>;
  if (b.disputed > 0) return <span className="ml-2 text-red-700">{formatMoney(b.disputed)} billed wrong: dispute it first, pay {formatMoney(b.total - b.disputed)}</span>;
  return null;
}

function sum(bills: Bill[]) {
  return bills.reduce((s, b) => s + b.total, 0);
}

async function Accounting() {
  let data;
  try {
    data = await loadAccounting(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const { today, restaurant, checks, owed, bills } = data;
  const problems = checks.filter((c) => c.status === "short" || c.status === "missing");

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold text-red-600">{formatMoney(owed)}</p>
          <p className="text-sm text-gray-600">Delivery apps owe you</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold">{formatMoney(sum(bills.overdue))}</p>
          <p className="text-sm text-gray-600">Bills overdue ({bills.overdue.length})</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold">{formatMoney(sum(bills.due_soon))}</p>
          <p className="text-sm text-gray-600">Bills due this week ({bills.due_soon.length})</p>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold">Delivery app payouts</h2>
        <p className="mb-3 text-sm text-gray-600">
          Each week&apos;s payout compared with your own orders: sales minus the app&apos;s fees. Plain math, no AI.
        </p>
        {problems.length === 0 && <p className="mb-3 text-sm text-green-700">Every finished week matches.</p>}
        <div className="mb-4 grid gap-2">
          {problems.map((c) => (
            <div key={`${c.platform}${c.period_start}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
              <p className="min-w-0 flex-1">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-red-700">{STATUS[c.status].label}</span>
                <span className="font-medium">{PLATFORMS[c.platform]}, week of {c.period_start}.</span> {c.message}
                <span className="ml-1 font-semibold">{formatMoney(-c.difference)}</span>
              </p>
              <CopyNote text={payoutDispute(c, restaurant)} />
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">Week</th>
                <th className="px-4 py-2 font-medium">App</th>
                <th className="px-4 py-2 text-right font-medium">Sales</th>
                <th className="px-4 py-2 text-right font-medium">Fees</th>
                <th className="px-4 py-2 text-right font-medium">Should pay</th>
                <th className="px-4 py-2 text-right font-medium">Paid</th>
                <th className="px-4 py-2 font-medium">Check</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={`${c.platform}${c.period_start}`} className="border-t border-gray-100">
                  <td className="px-4 py-2 tabular-nums">{c.period_start}</td>
                  <td className="px-4 py-2">{PLATFORMS[c.platform]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.expected_gross)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatMoney(c.expected_fees)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.expected_net)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.payout ? formatMoney(c.payout.net_amount) : "-"}</td>
                  <td className={`px-4 py-2 ${STATUS[c.status].className}`}>{STATUS[c.status].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Bills to pay</h2>
        {GROUPS.map(({ key, title }) =>
          bills[key].length ? (
            <div key={key} className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                {title} · {formatMoney(sum(bills[key]))}
              </h3>
              <div className="grid gap-2">
                {bills[key].map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
                    <p className="min-w-0 flex-1">
                      <span className="font-medium">{b.supplier}</span>{" "}
                      <Link href={`/invoices/${b.id}`} className="text-gray-500 underline decoration-gray-300">{b.invoice_number ?? `#${b.id}`}</Link>
                      <span className="ml-2 tabular-nums">{formatMoney(b.total)}</span>
                      <span className="ml-2 text-gray-500">due {b.due_date ?? "?"}</span>
                      <BillDispute bill={b} />
                    </p>
                    <MarkPaid invoiceId={b.id} />
                  </div>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Export for QuickBooks</h2>
        <p className="mb-3 text-sm text-gray-600">
          Payouts received and bills paid, as a file QuickBooks Online can import (Banking, Upload transactions). Check the dates match your bank
          before accepting them.
        </p>
        <QuickbooksExport defaultFrom={addDays(today, -30)} defaultTo={today} />
      </section>
    </>
  );
}

export default function AccountingPage() {
  return (
    <div>
      <PageHeader title="Accounting" description="Check that delivery apps paid what they owe, see which bills are due, and send it all to QuickBooks." />
      <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
        <Accounting />
      </Suspense>
    </div>
  );
}
