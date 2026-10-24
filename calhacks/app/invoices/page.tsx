import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

async function InvoicesTable() {
  const supabase = await getSupabase();
  // "suppliers(name)" follows the supplier_id foreign key to get the supplier's name.
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, due_date, total, status, suppliers(name)")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("invoice_date", { ascending: false });
  if (error) return <ErrorMessage message={error.message} />;

  // Flatten the nested supplier name and format money so the table can show them.
  const rows = data.map((invoice) => ({
    ...invoice,
    supplier: (invoice.suppliers as { name?: string } | null)?.name ?? "",
    total: formatMoney(invoice.total),
  }));

  return (
    <SimpleTable
      columns={[
        { key: "invoice_number", label: "Invoice #" },
        { key: "supplier", label: "Supplier" },
        { key: "invoice_date", label: "Date" },
        { key: "due_date", label: "Due" },
        { key: "total", label: "Total" },
        { key: "status", label: "Status" },
      ]}
      rows={rows}
    />
  );
}

export default function InvoicesPage() {
  return (
    <div>
      <PageHeader title="Invoices and buying" description="Check supplier invoices and create purchase orders." />
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <InvoicesTable />
      </Suspense>
    </div>
  );
}
