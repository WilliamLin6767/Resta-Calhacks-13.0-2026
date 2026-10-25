import Link from "next/link";
import { Suspense } from "react";
import AttentionBar from "@/components/attention/AttentionBar";
import { CallBadge } from "@/components/calls/CallControls";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import EmptyState from "@/components/ui/EmptyState";
import LiveValue from "@/components/ui/LiveValue";
import PreviewSection from "@/components/ui/Preview";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { table, tableWrap, td, tdNum, th, thead, thNum, tr } from "@/components/ui/table";
import { pendingCounts } from "@/lib/calls/service";
import { formatMoney } from "@/lib/format";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import { loadOrders, sortOrders } from "@/lib/purchasing/service";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { PurchaseOrderCard } from "./OrderActions";
import EmailInbox from "./EmailInbox";
import ScanInvoice from "./ScanInvoice";
import LiveRefresh from "@/components/live/LiveRefresh";

// How many orders the tab shows; the rest are on /invoices/orders.
const PREVIEW = 3;

async function PurchaseOrders() {
  let orders;
  try {
    orders = await loadOrders(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  if (!orders.length) return null;
  const top = sortOrders(orders).slice(0, PREVIEW);
  return (
    <PreviewSection id="orders" title="Purchase orders" href="/invoices/orders" total={orders.length} shown={top.length}>
      <div className="grid gap-3">
        {top.map((order) => <PurchaseOrderCard key={order.id} order={order} />)}
      </div>
    </PreviewSection>
  );
}

type Flag = { kind: string; severity: string; money_impact: number | null; resolved: boolean };

async function InvoicesTable() {
  const supabase = await getSupabase();
  const counts = await pendingCounts(supabase).catch(() => null);
  // `...suppliers(supplier:name)` adds the supplier's name to each row as `supplier`;
  // invoice_flags(...) brings each invoice's problems along (see supabase/04_purchasing.sql).
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, total, status, ...suppliers(supplier:name), invoice_flags(kind, severity, money_impact, resolved)")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("invoice_date", { ascending: false })
    .order("id", { ascending: false });

  if (error) return <ErrorMessage message={error.message} />;

  const rows = (data ?? []).map((inv) => {
    const open = ((inv.invoice_flags ?? []) as Flag[]).filter((f) => !f.resolved);
    return {
      ...inv,
      problems: open.filter((f) => f.severity !== "info").length,
      billedWrong: open.filter((f) => BILLING_ERROR_KINDS.has(f.kind)).reduce((s, f) => s + Number(f.money_impact ?? 0), 0),
      couldSave: open.filter((f) => f.kind === "cheaper_elsewhere").reduce((s, f) => s + Number(f.money_impact ?? 0), 0),
    };
  });
  const totalWrong = rows.reduce((s, r) => s + r.billedWrong, 0);
  const totalSave = rows.reduce((s, r) => s + r.couldSave, 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold tabular-nums text-red-600"><LiveValue value={formatMoney(totalWrong)} /></p>
          <p className="text-sm text-gray-600">Billed wrong (to dispute)</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold tabular-nums text-green-700"><LiveValue value={formatMoney(totalSave)} /></p>
          <p className="text-sm text-gray-600">Could save with other suppliers</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold tabular-nums"><LiveValue value={String(rows.filter((r) => r.problems > 0).length)} /></p>
          <p className="text-sm text-gray-600">Invoices with problems</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No invoices yet." hint="Scan one above, or try the sample invoice." icon="receipt" />
      ) : (
      <div className={tableWrap}>
        <table className={table}>
          <thead className={thead}>
            <tr>
              <th className={th}>Invoice #</th>
              <th className={th}>Supplier</th>
              <th className={th}>Date</th>
              <th className={thNum}>Total</th>
              <th className={th}>Status</th>
              <th className={th}>Problems</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={tr}>
                <td className={td}>
                  <Link href={`/invoices/${r.id}`} className="font-medium underline decoration-gray-300 hover:decoration-gray-900">
                    {r.invoice_number ?? `#${r.id}`}
                  </Link>
                  <CallBadge count={counts?.byContext[`invoice:${r.id}`]} />
                </td>
                <td className={td}>{String(r.supplier ?? "")}</td>
                <td className={td}>{r.invoice_date}</td>
                <td className={tdNum}>{formatMoney(r.total)}</td>
                <td className={td}>{r.status}</td>
                <td className={td}>
                  {r.problems > 0 ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      {r.problems} to check{r.billedWrong > 0 ? ` · ${formatMoney(r.billedWrong)} billed wrong` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">none found</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

// The three numbers and the invoice table, while they load.
function InvoicesSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-2xl" />
        ))}
      </div>
      <SkeletonTable rows={6} cols={6} />
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <div className="flex flex-col">
      <LiveRefresh topics={["invoices", "attention"]} />
      <PageHeader title="Invoices and buying" description="Scan invoices, match lines to ingredients, and approve purchase orders." />
      <div className="order-3 md:order-none">
        <AttentionBar tab="invoices" />
      </div>
      <div className="order-4 md:order-none">
        <ScanInvoice />
      </div>
      <div className="order-4 md:order-none">
        <Suspense fallback={<Skeleton className="mb-8 h-32 rounded-2xl" />}>
          <EmailInbox />
        </Suspense>
      </div>
      <div className="order-2 md:order-none">
        <Suspense fallback={<Skeleton className="mb-8 h-40 rounded-2xl" />}>
          <PurchaseOrders />
        </Suspense>
      </div>
      <div className="order-5 md:order-none">
        <Suspense fallback={<InvoicesSkeleton />}>
          <InvoicesTable />
        </Suspense>
      </div>
    </div>
  );
}
