import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

async function SuppliersTable() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("suppliers")
    .select("name, category, contact_name, phone, preferred_channel, lead_time_days, delivery_days")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("name");
  if (error) return <ErrorMessage message={error.message} />;

  return (
    <SimpleTable
      columns={[
        { key: "name", label: "Supplier" },
        { key: "category", label: "Category" },
        { key: "contact_name", label: "Contact" },
        { key: "phone", label: "Phone" },
        { key: "preferred_channel", label: "Order by" },
        { key: "lead_time_days", label: "Lead time (days)" },
        { key: "delivery_days", label: "Delivers" },
      ]}
      rows={data}
    />
  );
}

export default function SuppliersPage() {
  return (
    <div>
      <PageHeader title="Suppliers" description="Keep supplier contacts, prices and delivery days in one place." />
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <SuppliersTable />
      </Suspense>
    </div>
  );
}
