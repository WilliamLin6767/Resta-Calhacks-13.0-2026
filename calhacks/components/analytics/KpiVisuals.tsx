// Small pictures for the expanded KPI cards. Plain HTML and CSS (no chart library),
// rendered on the server, so they add nothing to the browser's JavaScript.

import EmptyState from "@/components/ui/EmptyState";
import type { ChannelRow, Digest, Kpis, PriceChangeRow } from "@/lib/analytics";
import { formatWholeMoney } from "@/lib/format";
import { channelName, type WaterfallStep } from "@/lib/insights";

const BAR = "#2a78d6";
const BAR_SOFT = "#c7dcf5";

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-medium tracking-wide text-gray-500 uppercase">{children}</p>;
}

// Revenue per day as tiny columns. Closed days show as a gap.
export function DailyBars({ daily }: { daily: Digest["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.revenue));
  const best = daily.reduce((a, b) => (b.revenue > a.revenue ? b : a), daily[0]);
  return (
    <div>
      <Caption>Revenue per day</Caption>
      <div className="flex h-24 items-end gap-0.5" aria-hidden="true">
        {daily.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.open ? formatWholeMoney(d.revenue) : "closed"}`}
            className="flex-1 rounded-t-sm"
            style={{ height: `${(d.revenue / max) * 100}%`, minHeight: d.open ? 2 : 0, background: BAR }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {daily.filter((d) => !d.open).length} closed days. Best day: {best?.date} at {formatWholeMoney(best?.revenue)}.
      </p>
    </div>
  );
}

// Revenue down to profit, each step as a bar sized against revenue.
export function ProfitSteps({ steps }: { steps: WaterfallStep[] }) {
  const revenue = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div>
      <Caption>Where each dollar goes</Caption>
      <ul className="space-y-1.5 text-sm">
        {steps.map((s) => (
          <li key={s.label} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2">
            <span className={`truncate ${s.kind === "cost" ? "text-gray-600" : "font-medium text-gray-900"}`}>{s.label}</span>
            <span className="h-2.5 rounded-full bg-gray-200">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(100, (s.value / revenue) * 100)}%`,
                  background: s.kind === "cost" ? "#eb6834" : s.amount < 0 ? "#e34948" : BAR,
                }}
              />
            </span>
            <span className="text-right tabular-nums text-gray-700">{formatWholeMoney(s.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The biggest supplier increases, which push food cost % up.
export function PriceIncreaseList({ changes }: { changes: PriceChangeRow[] }) {
  const top = changes
    .filter((p) => (p.est_period_impact ?? 0) > 0)
    .sort((a, b) => (b.est_period_impact ?? 0) - (a.est_period_impact ?? 0))
    .slice(0, 4);
  if (top.length === 0) return <EmptyState title="No supplier price increases cost you money this period." />;
  return (
    <div>
      <Caption>Price increases adding to food cost</Caption>
      <ul className="divide-y divide-gray-200 text-sm">
        {top.map((p) => (
          <li key={`${p.supplier}-${p.ingredient}`} className="flex items-baseline justify-between gap-3 py-1.5">
            <span>
              <span className="font-medium text-gray-900">{p.ingredient}</span>{" "}
              <span className="text-gray-500">
                +{p.change_pct}% at {p.supplier}
              </span>
              {p.cheapest_supplier && <span className="block text-xs text-green-700">Cheaper at {p.cheapest_supplier}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-red-700">+{formatWholeMoney(p.est_period_impact)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Revenue split into food, labor and everything left, as one bar.
export function PrimeCostBar({ kpis }: { kpis: Kpis }) {
  const parts = [
    { label: "Food", amount: kpis.food_cost, color: "#eb6834" },
    { label: "Labor", amount: kpis.labor, color: "#eda100" },
    { label: "Left for everything else", amount: Math.max(0, kpis.revenue - kpis.food_cost - kpis.labor), color: BAR_SOFT },
  ];
  const total = Math.max(1, kpis.revenue);
  return (
    <div>
      <Caption>Share of revenue</Caption>
      <div className="flex h-4 overflow-hidden rounded-full" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.amount / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-gray-700">{p.label}</span>
            <span className="ml-auto tabular-nums text-gray-900">
              {formatWholeMoney(p.amount)} ({Math.round((p.amount / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// For each delivery app: what you keep vs the fee, as one bar.
export function FeeBars({ channels }: { channels: ChannelRow[] }) {
  const apps = channels.filter((c) => c.platform_fees > 0);
  if (apps.length === 0) return <EmptyState title="No delivery app fees this period." />;
  return (
    <div>
      <Caption>Kept vs paid in fees</Caption>
      <ul className="space-y-3 text-sm">
        {apps.map((c) => (
          <li key={c.channel}>
            <div className="mb-1 flex justify-between">
              <span className="font-medium text-gray-900">{channelName(c.channel)}</span>
              <span className="text-gray-600 tabular-nums">
                kept {formatWholeMoney(c.net_revenue)} of {formatWholeMoney(c.revenue)}
              </span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden="true">
              <span style={{ width: `${(c.net_revenue / Math.max(1, c.revenue)) * 100}%`, background: BAR }} />
              <span style={{ width: `${(c.platform_fees / Math.max(1, c.revenue)) * 100}%`, background: "#e34948" }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
