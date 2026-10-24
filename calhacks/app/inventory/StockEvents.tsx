import { formatMoney } from "@/lib/format";
import type { StockEvent } from "@/lib/inventory/service";
import { countGap } from "@/lib/inventory/stock";

export function fmt(n: number) {
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

// Deliveries, counts and waste, newest first: on the Inventory tab (the latest few) and on Recent changes (all).
export default function StockEvents({ events, unitCost }: { events: StockEvent[]; unitCost: Map<number, number> }) {
  return (
    <ul className="divide-y divide-gray-100 rounded-2xl border border-brand-100 bg-white text-sm">
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
  );
}
