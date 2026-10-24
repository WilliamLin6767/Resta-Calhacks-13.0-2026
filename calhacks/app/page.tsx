import Link from "next/link";
import { Suspense } from "react";
import { DailyRevenueChart } from "@/components/analytics/Charts";
import AllAttention from "@/components/attention/AllAttention";
import Badge, { type BadgeTone } from "@/components/Badge";
import Card from "@/components/Card";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import EmptyState from "@/components/ui/EmptyState";
import ServiceTime from "@/components/ui/ServiceTime";
import { SkeletonChart, SkeletonLines, SkeletonStat, SkeletonTable } from "@/components/ui/Skeleton";
import Stat from "@/components/ui/Stat";
import { formatMoney } from "@/lib/format";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

// A date as "YYYY-MM-DD", `daysAgo` days before today in the restaurant's time zone (Berkeley).
function dateInLA(daysAgo: number): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

// Card 1: v_daily_sales has one row per day per channel, so add them up.
async function YesterdaySales() {
  const supabase = await getSupabase();
  const day = dateInLA(1);
  const { data, error } = await supabase
    .from("v_daily_sales")
    .select("revenue, order_count")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("day", day);
  if (error) return <ErrorMessage message={error.message} />;

  const revenue = data.reduce((sum, row) => sum + Number(row.revenue), 0);
  const orders = data.reduce((sum, row) => sum + Number(row.order_count), 0);

  return <Stat value={formatMoney(revenue)} sub={`${orders} orders on ${day}`} />;
}

// Card 2: revenue per day for the last 30 days (all channels added together).
async function RevenueLast30Days() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("v_daily_sales")
    .select("day, revenue, order_count")
    .eq("restaurant_id", RESTAURANT_ID)
    .gte("day", dateInLA(30))
    .lte("day", dateInLA(1))
    .order("day");
  if (error) return <ErrorMessage message={error.message} />;

  // Add up the channel rows for each day.
  const byDay = new Map<string, { date: string; open: boolean; orders: number; revenue: number }>();
  for (const row of data) {
    const entry = byDay.get(row.day) ?? { date: row.day, open: true, orders: 0, revenue: 0 };
    entry.revenue += Number(row.revenue);
    entry.orders += Number(row.order_count);
    byDay.set(row.day, entry);
  }
  const daily = [...byDay.values()];
  if (daily.length === 0) return <EmptyState title="No sales in the last 30 days." icon="chart" />;

  const total = daily.reduce((sum, d) => sum + d.revenue, 0);
  return (
    <div>
      <p className="mb-2 text-sm text-gray-500 tabular-nums">
        {formatMoney(total)} total over {daily.length} days with sales
      </p>
      <DailyRevenueChart daily={daily} />
    </div>
  );
}

// Card 3: ingredients at or below their reorder point.
async function LowStock() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("v_low_stock")
    .select("name, unit, current_qty, reorder_point, suggested_order_qty, preferred_supplier")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("current_qty");
  if (error) return <ErrorMessage message={error.message} />;
  if (data.length === 0) return <EmptyState title="Nothing is low. The walk-in is in good shape." icon="box" />;

  // Out of stock, or at half the reorder point or less, is urgent.
  const level = (qty: number, reorderAt: number): { tone: BadgeTone; label: string } => {
    if (qty <= 0) return { tone: "red", label: "Out" };
    if (qty <= reorderAt / 2) return { tone: "red", label: "Critical" };
    return { tone: "amber", label: "Low" };
  };

  return (
    <SimpleTable
      columns={[
        { key: "name", label: "Ingredient" },
        { key: "status", label: "Status" },
        { key: "on_hand", label: "On hand" },
        { key: "order", label: "Suggested order" },
        { key: "preferred_supplier", label: "Supplier" },
      ]}
      rows={data.map((item) => {
        const { tone, label } = level(Number(item.current_qty), Number(item.reorder_point));
        return {
          ...item,
          status: <Badge tone={tone}>{label}</Badge>,
          on_hand: <span className="tabular-nums">{`${item.current_qty} ${item.unit} (reorder at ${item.reorder_point})`}</span>,
          order: <span className="tabular-nums">{`${item.suggested_order_qty} ${item.unit}`}</span>,
        };
      })}
    />
  );
}

// Card 4: supplier prices that went up, biggest increase first.
async function PriceIncreases() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("v_supplier_price_changes")
    .select("supplier, ingredient, previous_price, current_price, change_pct, latest_date")
    .gt("change_pct", 0)
    .order("change_pct", { ascending: false })
    .limit(6);
  if (error) return <ErrorMessage message={error.message} />;
  if (data.length === 0) return <EmptyState title="No price increases in the last 30 days." icon="truck" />;

  // 15% or more is a big jump; 5% or more is worth a look.
  const tone = (pct: number): BadgeTone => (pct >= 15 ? "red" : pct >= 5 ? "amber" : "gray");

  return (
    <SimpleTable
      columns={[
        { key: "ingredient", label: "Ingredient" },
        { key: "supplier", label: "Supplier" },
        { key: "price", label: "Price" },
        { key: "change", label: "Change" },
        { key: "latest_date", label: "Since" },
      ]}
      rows={data.map((row) => ({
        ...row,
        price: <span className="tabular-nums">{`${formatMoney(row.previous_price)} → ${formatMoney(row.current_price)}`}</span>,
        change: <Badge tone={tone(Number(row.change_pct))}>+{row.change_pct}%</Badge>,
      }))}
    />
  );
}

// Card 5: AI suggestions nobody has acted on yet.
async function AiSuggestions() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("ai_insights")
    .select("id, kind, title, body")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq("status", "new")
    .order("created_at", { ascending: false });
  if (error) return <ErrorMessage message={error.message} />;
  if (data.length === 0) return <EmptyState title="No new suggestions. They show up here as the AI spots things." />;

  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {data.map((insight) => (
        <li key={insight.id} className="py-3 first:pt-0 last:pb-0">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="gray">{insight.kind}</Badge>
            <p className="font-medium text-gray-900">{insight.title}</p>
          </div>
          <p className="text-gray-600">{insight.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default function OverviewPage() {
  return (
    <div>
      <ServiceTime />
      <PageHeader title="Overview" description="How the restaurant is doing today, and what needs attention." />
      <AllAttention />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Yesterday's sales">
          <Suspense fallback={<SkeletonStat />}>
            <YesterdaySales />
          </Suspense>
        </Card>
        <Card
          title="Revenue, last 30 days"
          className="hidden md:block lg:col-span-2"
          action={
            <Link href="/analytics" className="text-xs font-medium text-gray-500 hover:text-gray-900">
              See analytics →
            </Link>
          }
        >
          <Suspense fallback={<SkeletonChart height={288} />}>
            <RevenueLast30Days />
          </Suspense>
        </Card>
        <Card title="Low stock" className="hidden md:block lg:col-span-3">
          <Suspense fallback={<SkeletonTable rows={4} cols={5} />}>
            <LowStock />
          </Suspense>
        </Card>
        <Card title="Supplier price increases" className="hidden md:block lg:col-span-2">
          <Suspense fallback={<SkeletonTable rows={4} cols={5} />}>
            <PriceIncreases />
          </Suspense>
        </Card>
        <Card title="AI suggestions" className="hidden md:block">
          <Suspense fallback={<SkeletonLines lines={5} />}>
            <AiSuggestions />
          </Suspense>
        </Card>
      </div>
      <p className="mt-4 md:hidden">
        <Link href="/analytics" className="text-sm font-medium text-gray-900 underline">
          See analytics
        </Link>
      </p>
    </div>
  );
}
