import { Suspense } from "react";
import AttentionBar from "@/components/attention/AttentionBar";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import { formatMoney } from "@/lib/format";
import { DELIVERY_MARKUP, TARGET_FOOD_COST } from "@/lib/pricing/pricing";
import { loadPricing, SYSTEMS, type PriceChange, type System } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { ApplyDeliveryPrices, ApprovePrice, MarkUpdated } from "./MenuActions";

// 1234.5 -> "$1,235", for estimates where cents are noise
function formatWholeMoney(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const CLASS_LABELS: Record<string, string> = {
  star: "Star: popular and profitable",
  plowhorse: "Plowhorse: popular, lower margin",
  puzzle: "Puzzle: profitable, sells little",
  dog: "Dog: sells little, lower margin",
};

// Systems a change still has to be copied to. A change to the in-house price only also shows on
// the apps when the dish has no separate app price.
function pending(c: PriceChange): System[] {
  const appsChanged = c.new_delivery_price !== c.old_delivery_price || (c.new_delivery_price === null && c.new_price !== c.old_price);
  return (Object.keys(SYSTEMS) as System[]).filter((s) => {
    if (s === "pos" && c.new_price === c.old_price) return false;
    if (s !== "pos" && !appsChanged) return false;
    return !c[`${s}_updated`];
  });
}

async function Pricing() {
  let data;
  try {
    data = await loadPricing(await getSupabase());
  } catch (err) {
    return <ErrorMessage message={`${err instanceof Error ? err.message : err}. Has supabase/05_pricing.sql been run?`} />;
  }
  const { since, suggestions, delivery, changes } = data;
  const raises = suggestions.filter((s) => s.action === "raise");
  const reviews = suggestions.filter((s) => s.action === "review");
  const toCopy = changes.filter((c) => pending(c).length > 0);

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold">{raises.length}</p>
          <p className="text-sm text-gray-600">Dishes to reprice</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold text-green-700">
            {formatWholeMoney(raises.reduce((s, r) => s + r.extra_profit, 0) + delivery.extra_profit)}
          </p>
          <p className="text-sm text-gray-600">More profit a month if you approve all (if sales hold)</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold">{toCopy.length}</p>
          <p className="text-sm text-gray-600">Price changes not in the POS or apps yet</p>
        </div>
      </div>

      <h2 className="mb-1 text-lg font-semibold">Suggested prices</h2>
      <p className="mb-3 text-sm text-gray-600">
        Ingredient costs today vs. {since}. Target food cost: {Math.round(TARGET_FOOD_COST * 100)}% of the price.
      </p>
      {raises.length + reviews.length === 0 && <p className="mb-8 text-sm text-gray-500">Every dish is priced fine right now.</p>}
      <div className="mb-8 grid gap-3">
        {[...raises, ...reviews].map((s) => (
          <div key={s.dish.id} className="rounded-2xl border border-brand-100 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {s.dish.name}
                {s.dish.class && <span className="ml-2 text-xs font-normal text-gray-500">{CLASS_LABELS[s.dish.class]}</span>}
              </p>
              <p className="tabular-nums">
                <span className="text-gray-500">{formatMoney(s.dish.price)}</span> → <span className="text-lg font-semibold">{formatMoney(s.new_price)}</span>
              </p>
            </div>
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
              {s.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                {s.action === "review" ? "Your call: this one needs a look first." : `About ${formatWholeMoney(s.extra_profit)} more a month if the same number sell.`}
              </p>
              <ApprovePrice menuItemId={s.dish.id} suggested={s.new_price ?? s.dish.price} reason={s.reasons[0] ?? ""} />
            </div>
          </div>
        ))}
      </div>

      {delivery.prices.length > 0 && (
        <div className="mb-8 rounded-2xl border border-brand-100 bg-white p-4">
          <h2 className="text-lg font-semibold">Delivery app prices</h2>
          <p className="mt-1 text-sm text-gray-700">
            DoorDash and Uber Eats keep {delivery.fee_pct}% of every order, and they are {delivery.share_pct}% of your sales. These dishes cost the
            same on the apps as in the restaurant. Most restaurants charge about {Math.round(DELIVERY_MARKUP * 100)}% more on the apps.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-600">
                <tr>
                  <th className="py-1 pr-4 font-medium">Dish</th>
                  <th className="py-1 pr-4 text-right font-medium">On the apps now</th>
                  <th className="py-1 pr-4 text-right font-medium">You keep</th>
                  <th className="py-1 text-right font-medium">Suggested</th>
                </tr>
              </thead>
              <tbody>
                {delivery.prices.map((p) => (
                  <tr key={p.menu_item_id} className="border-t border-gray-100">
                    <td className="py-1 pr-4">{p.name}</td>
                    <td className="py-1 pr-4 text-right tabular-nums">{formatMoney(p.delivery_price)}</td>
                    <td className="py-1 pr-4 text-right tabular-nums text-gray-500">{formatMoney(p.delivery_price * (1 - delivery.fee_pct / 100))}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{formatMoney(p.new_delivery_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">About {formatWholeMoney(delivery.extra_profit)} more a month if the same number of app orders come in.</p>
            <ApplyDeliveryPrices count={delivery.prices.length} />
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-1 text-lg font-semibold">Copy price changes to your other systems</h2>
          <p className="mb-3 text-sm text-gray-600">This app can&apos;t change the POS or delivery apps by itself yet. Tick each one once it&apos;s done.</p>
          <div className="grid gap-2">
            {changes.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-100 bg-white px-4 py-2 text-sm">
                <p>
                  <span className="font-medium">{c.menu_items?.name}</span>{" "}
                  {c.new_price !== c.old_price && <span className="tabular-nums">{formatMoney(c.old_price)} → {formatMoney(c.new_price)}</span>}
                  {c.new_delivery_price !== c.old_delivery_price && (
                    <span className="tabular-nums"> apps: {formatMoney(c.old_delivery_price ?? c.old_price)} → {formatMoney(c.new_delivery_price)}</span>
                  )}
                  <span className="ml-2 text-xs text-gray-400">{new Date(c.changed_at).toLocaleDateString("en-US")}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(SYSTEMS) as System[]).map((s) =>
                    pending(c).includes(s) || c[`${s}_updated`] ? (
                      <MarkUpdated key={s} changeId={c.id} system={s} label={SYSTEMS[s]} done={c[`${s}_updated`]} />
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Every dish</h2>
      <div className="overflow-x-auto rounded-2xl border border-brand-100 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-50 text-brand-700">
            <tr>
              <th className="px-4 py-2 font-medium">Dish</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">On the apps</th>
              <th className="px-4 py-2 text-right font-medium">Cost to make</th>
              <th className="px-4 py-2 text-right font-medium">Change</th>
              <th className="px-4 py-2 text-right font-medium">Food cost</th>
              <th className="px-4 py-2 text-right font-medium">Sold (30 days)</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s) => (
              <tr key={s.dish.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{s.dish.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.dish.price)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.dish.delivery_price ?? s.dish.price)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(s.cost_now)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${(s.cost_change_pct ?? 0) >= 3 ? "text-red-600" : "text-gray-500"}`}>
                  {s.cost_change_pct === null ? "" : `${s.cost_change_pct > 0 ? "+" : ""}${s.cost_change_pct}%`}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${s.food_cost_pct > TARGET_FOOD_COST * 100 ? "text-red-600" : ""}`}>{s.food_cost_pct}%</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.dish.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function MenuPage() {
  return (
    <div>
      <PageHeader title="Menu and pricing" description="What each dish costs to make right now, and what to charge. Plain math from your invoices and sales, no AI. Nothing changes until you approve it." />
      <AttentionBar tab="menu" />
      <Suspense fallback={<p className="text-sm text-gray-400">Loading...</p>}>
        <Pricing />
      </Suspense>
    </div>
  );
}
