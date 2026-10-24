import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

async function IngredientsTable() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("ingredients")
    .select("name, category, unit, current_qty, reorder_point, par_level")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("name");
  if (error) return <ErrorMessage message={error.message} />;

  return (
    <SimpleTable
      columns={[
        { key: "name", label: "Ingredient" },
        { key: "category", label: "Category" },
        { key: "current_qty", label: "On hand" },
        { key: "unit", label: "Unit" },
        { key: "reorder_point", label: "Reorder at" },
        { key: "par_level", label: "Par level" },
      ]}
      rows={data}
    />
  );
}

export default function InventoryPage() {
  return (
    <div>
      <PageHeader title="Inventory" description="Track what's on the shelf and what needs reordering." />
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <IngredientsTable />
      </Suspense>
    </div>
  );
}
