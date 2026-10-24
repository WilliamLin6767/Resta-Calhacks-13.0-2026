import { Suspense } from "react";
import AttentionBar from "@/components/attention/AttentionBar";
import { CallBadge } from "@/components/calls/CallControls";
import CallRequests from "@/components/calls/CallRequests";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import EmptyState from "@/components/ui/EmptyState";
import LiveValue from "@/components/ui/LiveValue";
import PreviewSection from "@/components/ui/Preview";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { table, tableWrap, td, tdNum, th, thead, thNum, tr } from "@/components/ui/table";
import { pendingCounts } from "@/lib/calls/service";
import { formatMoney } from "@/lib/format";
import { loadInventory } from "@/lib/inventory/service";
import { countGap } from "@/lib/inventory/stock";
import OrderPlan from "@/components/OrderPlan";
import { getSupabase } from "@/lib/supabase";
import Capture from "./Capture";
import SalesReceipts from "./SalesReceipts";
import StockEvents, { fmt } from "./StockEvents";

// How many recent changes the tab shows; the rest are on /inventory/changes.
const PREVIEW = 3;

const STATUS = {
  out: { label: "Out", className: "bg-red-50 text-red-700" },
  low: { label: "Low", className: "bg-amber-50 text-amber-800" },
  ok: { label: "OK", className: "text-gray-500" },
};

async function Inventory() {
  let data;
  let counts = null;
  try {
    const supabase = await getSupabase();
    [data, counts] = await Promise.all([loadInventory(supabase), pendingCounts(supabase).catch(() => null)]);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const { lines, events, wasteWeek, unitCost } = data;
  const low = lines.filter((l) => l.status !== "ok");
  const missing = events
    .filter((e) => e.kind === "count" && Number(e.change) < 0 && countGap(Number(e.qty_after) - Number(e.change), Number(e.qty_after)).notable)
    .reduce((s, e) => s + -Number(e.change) * Number(e.unit_cost ?? 0), 0);
  const order = { out: 0, low: 1, ok: 2 };
  const sorted = [...lines].sort((a, b) => order[a.status] - order[b.status] || (a.days_left ?? 99) - (b.days_left ?? 99));

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className={`text-2xl font-semibold tabular-nums ${low.length ? "text-amber-700" : ""}`}><LiveValue value={String(low.length)} /></p>
          <p className="text-sm text-gray-600">Items low or out</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold tabular-nums"><LiveValue value={formatMoney(wasteWeek)} /></p>
          <p className="text-sm text-gray-600">Thrown out this week (at cost)</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className={`text-2xl font-semibold tabular-nums ${missing > 0 ? "text-red-600" : ""}`}><LiveValue value={formatMoney(missing)} /></p>
          <p className="text-sm text-gray-600">Counted less than expected (recent counts)</p>
        </div>
      </div>

      <SalesReceipts />

      <Capture ingredients={lines.map((l) => ({ id: l.id, name: l.name, unit: l.unit }))} />

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Stock</h2>
            <p className="text-sm text-gray-600">Last count, plus deliveries, minus waste and what sales used since (from recipes).</p>
          </div>
          {low.length > 0 && <OrderPlan request={{ kind: "low" }} label={`Plan orders for ${low.length} low ${low.length === 1 ? "item" : "items"}`} />}
        </div>
        <div className={tableWrap}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>Ingredient</th>
                <th className={thNum}>On hand now</th>
                <th className={thNum}>Uses a day</th>
                <th className={thNum}>Lasts</th>
                <th className={thNum}>Reorder at / par</th>
                <th className={th}>Last counted</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} className={tr}>
                  <td className={td}>
                    {l.name}
                    <CallBadge count={counts?.byContext[`ingredient:${l.id}`]} />
                  </td>
                  <td className={tdNum}>
                    {/* Flashes when a count, waste entry or receipt changes it */}
                    <LiveValue value={`${fmt(l.estimated)} ${l.unit}`} />
                    {l.used_since > 0 && <span className="block text-xs text-gray-400">counted {fmt(l.current_qty)}, sales used {fmt(l.used_since)}</span>}
                  </td>
                  <td className={`${tdNum} text-gray-500`}>{fmt(l.daily_use)}</td>
                  <td className={tdNum}>{l.days_left === null ? "-" : `${fmt(l.days_left)} days`}</td>
                  <td className={`${tdNum} text-gray-500`}>{fmt(Number(l.reorder_point ?? 0))} / {fmt(Number(l.par_level ?? 0))}</td>
                  <td className={`${td} text-gray-500`}>{l.last_counted ?? "never"}</td>
                  <td className={td}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[l.status].className}`}>{STATUS[l.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* No ingredient detail page yet, so ingredient calls (orders, price questions) show here. */}
      <CallRequests contextType="ingredient" title="Supplier calls about stock" hideWhenEmpty view="preview" moreHref="/inventory/calls" />

      <PreviewSection title="Recent changes" href="/inventory/changes" total={events.length} shown={Math.min(PREVIEW, events.length)}>
        {events.length === 0 ? (
          <EmptyState title="No deliveries, counts or waste logged yet." hint="Scan an invoice, count a shelf or log waste above." icon="box" />
        ) : (
          <StockEvents events={events.slice(0, PREVIEW)} unitCost={unitCost} />
        )}
      </PreviewSection>
    </>
  );
}

// The three numbers and the stock table, while they load.
function InventorySkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-2xl" />
        ))}
      </div>
      <SkeletonTable rows={8} cols={7} />
    </div>
  );
}

export default function InventoryPage() {
  return (
    <div>
      <PageHeader title="Inventory" description="What's on hand, how long it lasts, and what went missing. Deliveries come in from scanned invoices." />
      <AttentionBar tab="inventory" />
      <Suspense fallback={<InventorySkeleton />}>
        <Inventory />
      </Suspense>
    </div>
  );
}
