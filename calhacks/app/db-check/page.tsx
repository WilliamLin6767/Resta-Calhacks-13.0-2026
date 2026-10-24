import { Suspense } from "react";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// Temporary page to confirm the app can read the database. Delete after checking.
async function DbCheck() {
  const supabase = await getSupabase();

  const counts: Record<string, number | string> = {};
  for (const table of ["orders", "menu_items", "ingredients"]) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", RESTAURANT_ID);
    counts[table] = error ? `error: ${error.message}` : (count ?? 0);
  }

  const { data, error } = await supabase.rpc("analytics_digest", {
    p_restaurant_id: RESTAURANT_ID,
    p_days: 30,
  });
  const digest = error
    ? { error: error.message }
    : { version: data?.version, revenue: data?.kpis?.cur?.revenue };

  return <pre>{JSON.stringify({ restaurant_id: RESTAURANT_ID, counts, analytics_digest: digest }, null, 2)}</pre>;
}

export default function DbCheckPage() {
  return (
    <main className="p-8">
      <h1 className="mb-4 text-xl font-bold">DB check</h1>
      <Suspense fallback={<p>Checking...</p>}>
        <DbCheck />
      </Suspense>
    </main>
  );
}
