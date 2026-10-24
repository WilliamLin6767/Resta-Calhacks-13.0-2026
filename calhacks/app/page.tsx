import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// Yesterday's date as "YYYY-MM-DD" in the restaurant's time zone (Berkeley).
function yesterdayInLA(): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// A white box with a title. Each card on the overview uses this.
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-gray-200 bg-white p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Loading() {
  return <p className="text-sm text-gray-500">Loading...</p>;
}

// Card 1: v_daily_sales has one row per day per channel, so add them up.
async function YesterdaySales() {
  const supabase = await getSupabase();
  const day = yesterdayInLA();
  const { data, error } = await supabase
    .from("v_daily_sales")
    .select("revenue, order_count")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("day", day);
  if (error) return <ErrorMessage message={error.message} />;

  const revenue = data.reduce((sum, row) => sum + Number(row.revenue), 0);
  const orders = data.reduce((sum, row) => sum + Number(row.order_count), 0);

  return (
    <div>
      <p className="text-3xl font-bold">{formatMoney(revenue)}</p>
      <p className="text-sm text-gray-500">
        {orders} orders on {day}
      </p>
    </div>
  );
}

// Card 2: ingredients at or below their reorder point.
async function LowStock() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("v_low_stock")
    .select("ingredient_id, name, unit, current_qty, reorder_point")
    .eq("restaurant_id", RESTAURANT_ID);
  if (error) return <ErrorMessage message={error.message} />;
  if (data.length === 0) return <p className="text-sm text-gray-500">Nothing is low.</p>;

  return (
    <ul className="space-y-1 text-sm">
      {data.map((item) => (
        <li key={item.ingredient_id}>
          <span className="font-medium">{item.name}</span>: {item.current_qty} {item.unit} left
          (reorder at {item.reorder_point})
        </li>
      ))}
    </ul>
  );
}

// Card 3: supplier prices that went up, biggest increase first.
async function PriceIncreases() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("v_supplier_price_changes")
    .select("supplier, ingredient, ingredient_id, supplier_id, previous_price, current_price, change_pct")
    .gt("change_pct", 0)
    .order("change_pct", { ascending: false })
    .limit(5);
  if (error) return <ErrorMessage message={error.message} />;
  if (data.length === 0) return <p className="text-sm text-gray-500">No recent increases.</p>;

  return (
    <ul className="space-y-1 text-sm">
      {data.map((row) => (
        <li key={`${row.supplier_id}-${row.ingredient_id}`}>
          <span className="font-medium">{row.ingredient}</span> at {row.supplier}:{" "}
          {formatMoney(row.previous_price)} → {formatMoney(row.current_price)}{" "}
          <span className="text-red-600">(+{row.change_pct}%)</span>
        </li>
      ))}
    </ul>
  );
}

// Card 4: AI suggestions nobody has acted on yet.
async function AiSuggestions() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("ai_insights")
    .select("id, title, body")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("status", "new")
    .order("created_at", { ascending: false });
  if (error) return <ErrorMessage message={error.message} />;
  if (data.length === 0) return <p className="text-sm text-gray-500">No new suggestions.</p>;

  return (
    <ul className="space-y-3 text-sm">
      {data.map((insight) => (
        <li key={insight.id}>
          <p className="font-medium">{insight.title}</p>
          <p className="text-gray-600">{insight.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default function OverviewPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Overview</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Yesterday's sales">
          <Suspense fallback={<Loading />}>
            <YesterdaySales />
          </Suspense>
        </Card>
        <Card title="Low stock">
          <Suspense fallback={<Loading />}>
            <LowStock />
          </Suspense>
        </Card>
        <Card title="Supplier price increases">
          <Suspense fallback={<Loading />}>
            <PriceIncreases />
          </Suspense>
        </Card>
        <Card title="AI suggestions">
          <Suspense fallback={<Loading />}>
            <AiSuggestions />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
