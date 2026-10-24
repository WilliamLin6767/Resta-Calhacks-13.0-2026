import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import SimpleTable from "@/components/SimpleTable";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

async function MenuSalesTable() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("v_menu_item_sales")
    .select("menu_item_id, name, category, units_sold, revenue, est_food_cost")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("revenue", { ascending: false });
  if (error) return <ErrorMessage message={error.message} />;

  // Format the money columns for display.
  const rows = data.map((item) => ({
    ...item,
    revenue: formatMoney(item.revenue),
    est_food_cost: formatMoney(item.est_food_cost),
  }));

  return (
    <SimpleTable
      columns={[
        { key: "name", label: "Dish" },
        { key: "category", label: "Category" },
        { key: "units_sold", label: "Units sold" },
        { key: "revenue", label: "Revenue" },
        { key: "est_food_cost", label: "Est. food cost" },
      ]}
      rows={rows}
    />
  );
}

export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="mb-6 text-gray-600">See which dishes sell and which ones make money.</p>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <MenuSalesTable />
      </Suspense>
    </div>
  );
}
