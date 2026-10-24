import { Suspense } from "react";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import { formatMoney } from "@/lib/format";
import { loadInventory, type StockEvent } from "@/lib/inventory/service";
import { countGap } from "@/lib/inventory/stock";
import { getSupabase } from "@/lib/supabase";
import Capture from "./Capture";
import ReorderButton from "./ReorderButton";
import SalesReceipts from "./SalesReceipts";

const STATUS = {
  out: { label: "Out", className: "bg-red-50 text-red-700" },
  low: { label: "Low", className: "bg-amber-50 text-amber-800" },
  ok: { label: "OK", className: "text-gray-500" },
};

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function eventText(e: StockEvent) {
  const name = e.ingredients?.name ?? "item";
  const unit = e.ingredients?.unit ?? "";
  if (e.kind === "delivery") return `${name}: +${fmt(Number(e.change))} ${unit} delivered (${e.reason ?? "invoice"})`;
  if (e.kind === "waste") return `${name}: ${fmt(-Number(e.change))} ${unit} thrown out, ${e.reason}`;
  const expected = Number(e.qty_after) - Number(e.change);
  const gap = countGap(expected, Number(e.qty_after));
  return `${name}: counted ${fmt(Number(e.qty_after))} ${unit}${
    gap.notable ? `, ${fmt(Math.abs(gap.change))} ${unit} ${gap.change < 0 ? "less" : "more"} than expected` : ", as expected"
  }`;
}

async function Inventory() {
  let data;
  try {
    data = await loadInventory(await getSupabase());
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
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className={`text-2xl font-semibold ${low.length ? "text-amber-700" : ""}`}>{low.length}</p>
          <p className="text-sm text-gray-600">Items low or out</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-2xl font-semibold">{formatMoney(wasteWeek)}</p>
          <p className="text-sm text-gray-600">Thrown out this week (at cost)</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className={`text-2xl font-semibold ${missing > 0 ? "text-red-600" : ""}`}>{formatMoney(missing)}</p>
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
          {low.length > 0 && <ReorderButton count={low.length} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">Ingredient</th>
                <th className="px-4 py-2 text-right font-medium">On hand now</th>
                <th className="px-4 py-2 text-right font-medium">Uses a day</th>
                <th className="px-4 py-2 text-right font-medium">Lasts</th>
                <th className="px-4 py-2 text-right font-medium">Reorder at / par</th>
                <th className="px-4 py-2 font-medium">Last counted</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{l.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmt(l.estimated)} {l.unit}
                    {l.used_since > 0 && <span className="block text-xs text-gray-400">counted {fmt(l.current_qty)}, sales used {fmt(l.used_since)}</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{fmt(l.daily_use)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.days_left === null ? "-" : `${fmt(l.days_left)} days`}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{fmt(Number(l.reorder_point ?? 0))} / {fmt(Number(l.par_level ?? 0))}</td>
                  <td className="px-4 py-2 text-gray-500">{l.last_counted ?? "never"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[l.status].className}`}>{STATUS[l.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent changes</h2>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No deliveries, counts or waste logged yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>{eventText(e)}</span>
                <span className="text-xs text-gray-400">
                  {e.kind === "waste" && unitCost.get(e.ingredient_id) ? `${formatMoney(-Number(e.change) * Number(e.unit_cost ?? 0))} · ` : ""}
                  {e.source ? `${e.source} · ` : ""}
                  {new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function InventoryPage() {
  return (
    <div>
      <PageHeader title="Inventory" description="What's on hand, how long it lasts, and what went missing. Deliveries come in from scanned invoices." />
      <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
        <Inventory />
      </Suspense>
    </div>
  );
}
