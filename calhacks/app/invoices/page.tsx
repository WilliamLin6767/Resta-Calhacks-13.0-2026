import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import { formatMoney } from "@/lib/format";
import { BILLING_ERROR_KINDS } from "@/lib/purchasing/checks";
import { loadOrders } from "@/lib/purchasing/service";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";
import { OrderButtons } from "./OrderActions";
import ScanInvoice from "./ScanInvoice";

const STATUS_LABEL: Record<string, string> = { draft: "Waiting for your approval", approved: "Approved, not sent yet", sent: "Sent, waiting for delivery" };

async function PurchaseOrders() {
  let orders;
  try {
    orders = await loadOrders(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  if (!orders.length) return null;
  return (
    <section id="orders" className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">Purchase orders</h2>
      <div className="grid gap-3">
        {orders.map((o) => (
          <div key={o.id} className={`rounded-lg border bg-white p-4 ${o.status === "draft" ? "border-amber-300" : "border-gray-200"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {o.supplier}
                {o.created_by === "ai" && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">suggested by the app</span>}
              </p>
              <p className="text-sm text-gray-600">{STATUS_LABEL[o.status] ?? o.status}</p>
            </div>
            {o.reason && <p className="mt-1 text-sm text-gray-700">{o.reason}</p>}
            <ul className="mt-2 text-sm">
              {o.lines.map((l, i) => (
                <li key={i} className="tabular-nums">
                  {l.qty} x {l.ingredient}{l.pack_desc ? ` (${l.pack_desc})` : ""}
                  {l.est_unit_price !== null && <span className="text-gray-500"> at {formatMoney(l.est_unit_price)}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-sm">
              About <span className="font-medium">{formatMoney(o.total)}</span> · {o.status === "sent" ? "expected" : "can arrive"} {o.delivery_date}
              {o.below_minimum > 0 && o.status !== "sent" && (
                <span className="ml-2 text-amber-700">
                  {formatMoney(o.below_minimum)} below this supplier&apos;s {formatMoney(o.min_order_amount)} minimum
                </span>
              )}
            </p>
            {o.status !== "sent" && <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">&quot;{o.message}&quot;</p>}
            <div className="mt-3">
              <OrderButtons orderId={o.id} status={o.status} message={o.message} contact={o.contact} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type Flag = { kind: string; severity: string; money_impact: number | null; resolved: boolean };

async function InvoicesTable() {
  const supabase = await getSupabase();
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
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold text-red-600">{formatMoney(totalWrong)}</p>
          <p className="text-sm text-gray-600">Billed wrong (to dispute)</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold text-green-700">{formatMoney(totalSave)}</p>
          <p className="text-sm text-gray-600">Could save with other suppliers</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold">{rows.filter((r) => r.problems > 0).length}</p>
          <p className="text-sm text-gray-600">Invoices with problems</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice #</th>
              <th className="px-4 py-2 font-medium">Supplier</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Problems</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link href={`/invoices/${r.id}`} className="font-medium underline decoration-gray-300 hover:decoration-gray-900">
                    {r.invoice_number ?? `#${r.id}`}
                  </Link>
                </td>
                <td className="px-4 py-2">{String(r.supplier ?? "")}</td>
                <td className="px-4 py-2">{r.invoice_date}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.total)}</td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">
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
    </>
  );
}

export default function InvoicesPage() {
  return (
    <div>
      <PageHeader title="Invoices and buying" description="Scan invoices, match lines to ingredients, and approve purchase orders." />
      <ScanInvoice />
      <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
        <PurchaseOrders />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
        <InvoicesTable />
      </Suspense>
    </div>
  );
}
