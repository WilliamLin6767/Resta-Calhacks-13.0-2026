import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import AddToMenuButton from "@/components/trends/AddToMenuButton";
import ScanTrendsButton from "@/components/trends/ScanTrendsButton";
import { NEW_INGREDIENT_CAP, compareRecommendations, isOnMenu } from "@/lib/trends/score";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

type YelpEvidence = { business?: string; rating?: number; reviewCount?: number; url?: string };
type SocialEvidence = { platform?: string; url?: string; views?: number; likes?: number };

type Recommendation = {
  dish_name: string;
  demand_score: number;
  fit_score: number;
  recommend_score: number;
  new_ingredient_count: number;
  have_ingredients: string[] | null;
  new_ingredients: string[] | null;
  reason: string;
  evidence: { yelp?: YelpEvidence[]; social?: SocialEvidence[] } | null;
  scraped_at: string;
};

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function links(row: Recommendation) {
  const yelp = (row.evidence?.yelp ?? []).filter((hit) => hit.url);
  const social = (row.evidence?.social ?? []).filter((hit) => hit.url);
  return { yelp, social };
}

async function Recommendations() {
  const supabase = await getSupabase();
  const [listed, menu] = await Promise.all([
    supabase
      .from("dish_recommendations")
      .select("dish_name, demand_score, fit_score, recommend_score, new_ingredient_count, have_ingredients, new_ingredients, reason, evidence, scraped_at")
      .eq("restaurant_id", RESTAURANT_ID),
    supabase.from("menu_items").select("name").eq("restaurant_id", RESTAURANT_ID).eq("active", true),
  ]);
  const { data, error } = listed;
  if (error) {
    const missing = /dish_recommendations|schema cache/i.test(error.message);
    return <ErrorMessage message={missing ? `${error.message} Has supabase/15_dish_recommendations.sql been run?` : error.message} />;
  }

  if (menu.error) return <ErrorMessage message={menu.error.message} />;
  const menuNames = (menu.data ?? []).map((item) => item.name);
  const rows = ((data ?? []) as Recommendation[]).sort(compareRecommendations);
  const scanned = rows.map((row) => row.scraped_at).sort().at(-1);
  const top = rows.find((row) => row.new_ingredient_count <= NEW_INGREDIENT_CAP);

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold">Dishes to add</h2>
      <p className="mb-4 max-w-2xl text-sm text-gray-600">
        Ranked by how often nearby diners and recent posts mention them, times how much of the recipe you already stock.
        {scanned ? ` Last scan ${new Date(scanned).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.` : ""}
      </p>
      {rows.length === 0 && <p className="text-sm text-gray-500">No scan yet. Run a scan to see dishes worth adding.</p>}
      <div className="grid gap-3">
        {rows.map((row) => {
          const ready = row.new_ingredient_count <= NEW_INGREDIENT_CAP;
          const source = links(row);
          const have = row.have_ingredients ?? [];
          const need = row.new_ingredients ?? [];
          return (
            <article key={row.dish_name} className="rounded-2xl border border-brand-100 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {row.dish_name}
                    {row === top && <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">Add this</span>}
                    {!ready && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">More shopping</span>}
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-gray-600">
                    Trend {pct(row.demand_score)} · Kitchen fit {pct(row.fit_score)}
                  </p>
                </div>
                <AddToMenuButton dishName={row.dish_name} onMenu={isOnMenu(row.dish_name, menuNames)} />
              </div>
              <p className="mt-2 text-sm text-gray-700">{row.reason}</p>
              <p className="mt-2 text-sm text-gray-700">
                <span className="font-medium">Already in stock:</span> {have.length > 0 ? have.join(", ") : "none"}
              </p>
              <p className="text-sm text-gray-700">
                <span className="font-medium">Would buy:</span> {need.length > 0 ? need.join(", ") : "nothing new"}
                {need.length > 0 ? ` (${need.length} new)` : ""}
              </p>
              {(source.yelp.length > 0 || source.social.length > 0) && (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {source.yelp.slice(0, 3).map((hit) => (
                    <li key={hit.url}>
                      <a href={hit.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                        {hit.business || "Yelp"}
                      </a>
                    </li>
                  ))}
                  {source.social.slice(0, 3).map((hit) => (
                    <li key={hit.url}>
                      <a href={hit.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                        {hit.platform === "tiktok" ? "TikTok" : "Instagram"}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

async function TrendsTable() {
  const supabase = await getSupabase();
  // market_trends has no restaurant_id: trends are shared across restaurants.
  const { data, error } = await supabase
    .from("market_trends")
    .select("keyword, region, score, change_pct, observed_at, source")
    .order("score", { ascending: false });
  if (error) return <ErrorMessage message={error.message} />;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Saved trend keywords</h2>
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
    </section>
  );
}

export default function TrendsPage() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Trends"
          description="Dishes nearby diners and social posts are asking for, ranked by what you can add without a new shopping list."
        />
        <ScanTrendsButton />
      </div>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <Recommendations />
        <TrendsTable />
      </Suspense>
    </div>
  );
}
