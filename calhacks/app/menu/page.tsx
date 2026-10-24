import { Suspense } from "react";
import AttentionBar from "@/components/attention/AttentionBar";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import EmptyState from "@/components/ui/EmptyState";
import Fold from "@/components/ui/Fold";
import LiveValue from "@/components/ui/LiveValue";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { table, tableWrap, td, tdNum, th, thead, thNum, tr } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { DELIVERY_MARKUP, TARGET_FOOD_COST } from "@/lib/pricing/pricing";
import { loadPricing, SYSTEMS, type PriceChange, type System } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { ApplyDeliveryPrices, ApprovePrice, MarkUpdated } from "./MenuActions";
import LiveRefresh from "@/components/live/LiveRefresh";

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
          <p className="text-2xl font-semibold tabular-nums"><LiveValue value={String(raises.length)} /></p>
          <p className="text-sm text-gray-600">Dishes to reprice</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold tabular-nums text-green-700">
            <LiveValue value={formatWholeMoney(raises.reduce((s, r) => s + r.extra_profit, 0) + delivery.extra_profit)} />
          </p>
          <p className="text-sm text-gray-600">More profit a month if you approve all (if sales hold)</p>
        </div>
        <div className="rounded-2xl border border-brand-100 bg-white p-4">
          <p className="text-2xl font-semibold tabular-nums"><LiveValue value={String(toCopy.length)} /></p>
          <p className="text-sm text-gray-600">Price changes not in the POS or apps yet</p>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Suggested prices</h2>
        {raises.length + reviews.length === 0 ? (
          <div className="rounded-2xl border border-brand-100 bg-white">
            <EmptyState title="Every dish is priced fine right now." icon="tag" />
          </div>
        ) : (
          <Fold
            summary={
              <>
                {raises.length > 0 && (
                  <span className="flex items-center gap-2 font-medium text-gray-900"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />{raises.length} {raises.length === 1 ? "dish" : "dishes"} to reprice</span>
                )}
                {reviews.length > 0 && <span className="text-gray-600">{reviews.length} to look at first</span>}
              </>
            }
          >
            <p className="mb-3 px-1 text-sm text-gray-600">
              Ingredient costs today vs. {since}. Target food cost: {Math.round(TARGET_FOOD_COST * 100)}% of the price.
            </p>
            <div className="grid gap-3">
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
          </Fold>
        )}
      </section>

      {delivery.prices.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Delivery app prices</h2>
          <Fold
            summary={
              <span className="text-gray-700">
                {delivery.prices.length} {delivery.prices.length === 1 ? "dish costs" : "dishes cost"} the same on the apps · about {formatWholeMoney(delivery.extra_profit)} more a month
              </span>
            }
          >
            <div className="rounded-2xl border border-brand-100 bg-white p-4">
              <p className="text-sm text-gray-700">
                DoorDash and Uber Eats keep {delivery.fee_pct}% of every order, and they are {delivery.share_pct}% of your sales. These dishes cost the
                same on the apps as in the restaurant. Most restaurants charge about {Math.round(DELIVERY_MARKUP * 100)}% more on the apps.
              </p>
              <div className={`mt-3 ${tableWrap}`}>
                <table className={table}>
                  <thead className={thead}>
                    <tr>
                      <th className={th}>Dish</th>
                      <th className={thNum}>On the apps now</th>
                      <th className={thNum}>You keep</th>
                      <th className={thNum}>Suggested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {delivery.prices.map((p) => (
                      <tr key={p.menu_item_id} className={tr}>
                        <td className={td}>{p.name}</td>
                        <td className={tdNum}>{formatMoney(p.delivery_price)}</td>
                        <td className={`${tdNum} text-gray-500`}>{formatMoney(p.delivery_price * (1 - delivery.fee_pct / 100))}</td>
                        <td className={`${tdNum} font-medium`}>{formatMoney(p.new_delivery_price)}</td>
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
          </Fold>
        </section>
      )}

      {changes.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Copy price changes to your other systems</h2>
          <Fold
            summary={
              toCopy.length > 0 ? (
                <span className="flex items-center gap-2 font-medium text-gray-900"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />{toCopy.length} not in the POS or apps yet</span>
              ) : (
                <span className="text-gray-600">All {changes.length} copied over</span>
              )
            }
          >
            <p className="mb-3 px-1 text-sm text-gray-600">This app can&apos;t change the POS or delivery apps by itself yet. Tick each one once it&apos;s done.</p>
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
          </Fold>
        </section>
      )}

      <h2 className="mb-3 text-lg font-semibold">Every dish</h2>
      <div className={tableWrap}>
        <table className={table}>
          <thead className={thead}>
            <tr>
              <th className={th}>Dish</th>
              <th className={thNum}>Price</th>
              <th className={thNum}>On the apps</th>
              <th className={thNum}>Cost to make</th>
              <th className={thNum}>Change</th>
              <th className={thNum}>Food cost</th>
              <th className={thNum}>Sold (30 days)</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s) => (
              <tr key={s.dish.id} className={tr}>
                <td className={td}>{s.dish.name}</td>
                {/* Price, app price and food cost flash after an approval changes them */}
                <td className={tdNum}><LiveValue value={formatMoney(s.dish.price)} /></td>
                <td className={tdNum}><LiveValue value={formatMoney(s.dish.delivery_price ?? s.dish.price)} /></td>
                <td className={tdNum}>{formatMoney(s.cost_now)}</td>
                <td className={`${tdNum} ${(s.cost_change_pct ?? 0) >= 3 ? "text-red-600" : "text-gray-500"}`}>
                  {s.cost_change_pct === null ? "" : `${s.cost_change_pct > 0 ? "+" : ""}${s.cost_change_pct}%`}
                </td>
                <td className={`${tdNum} ${s.food_cost_pct > TARGET_FOOD_COST * 100 ? "text-red-600" : ""}`}><LiveValue value={`${s.food_cost_pct}%`} /></td>
                <td className={tdNum}>{s.dish.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The three numbers, a couple of suggested prices and the dish table, while they load.
function PricingSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mb-3 h-6 w-48" />
      <div className="mb-8 grid gap-3">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </div>
      <SkeletonTable rows={6} cols={7} />
    </div>
  );
}

export default function MenuPage() {
  return (
    <div>
      <PageHeader title="Menu and pricing" description="What each dish costs to make right now, and what to charge. Plain math from your invoices and sales, no AI. Nothing changes until you approve it." />
      <LiveRefresh topics={["menu", "attention"]} />
      <AttentionBar tab="menu" />
      <Suspense fallback={<PricingSkeleton />}>
        <Pricing />
      </Suspense>
    </div>
  );
}
