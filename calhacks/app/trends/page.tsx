import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import { getSupabase } from "@/lib/supabase";

async function TrendsTable() {
  const supabase = await getSupabase();
  // market_trends has no restaurant_id: trends are shared across restaurants.
  const { data, error } = await supabase
    .from("market_trends")
    .select("keyword, region, score, change_pct, observed_at, source")
    .order("score", { ascending: false });
  if (error) return <ErrorMessage message={error.message} />;

  return (
    <SimpleTable
      columns={[
        { key: "keyword", label: "Trend" },
        { key: "region", label: "Region" },
        { key: "score", label: "Score" },
        { key: "change_pct", label: "Change %" },
        { key: "observed_at", label: "Seen on" },
        { key: "source", label: "Source" },
      ]}
      rows={data}
    />
  );
}

export default function TrendsPage() {
  return (
    <div>
      <PageHeader title="Trends" description="Spot food trends worth adding to the menu." />
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <TrendsTable />
      </Suspense>
    </div>
  );
}
