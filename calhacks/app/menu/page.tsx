import Link from "next/link";
import { Suspense } from "react";
import AttentionBar from "@/components/attention/AttentionBar";
import PageHeader from "@/components/PageHeader";
import ErrorMessage from "@/components/ErrorMessage";
import EmptyState from "@/components/ui/EmptyState";
import Fold from "@/components/ui/Fold";
import LiveValue from "@/components/ui/LiveValue";
import PreviewSection from "@/components/ui/Preview";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { table, tableWrap, td, tdNum, th, thead, thNum, tr } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { DELIVERY_MARKUP, TARGET_FOOD_COST } from "@/lib/pricing/pricing";
import { loadPricing } from "@/lib/pricing/service";
import { getSupabase } from "@/lib/supabase";
import { ChangeRow, copyFirst, formatWholeMoney, pending, SuggestionCard } from "./parts";
import LiveRefresh from "@/components/live/LiveRefresh";

// How many of each list the tab shows; the rest are on /menu/suggestions and /menu/changes.
const PREVIEW = 3;

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
  const suggested = [...raises, ...reviews];

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

      <PreviewSection
        title="Suggested prices"
        description={<>Ingredient costs today vs. {since}. Target food cost: {Math.round(TARGET_FOOD_COST * 100)}% of the price.</>}
        href="/menu/suggestions"
        total={suggested.length}
        shown={Math.min(PREVIEW, suggested.length)}
      >
        {suggested.length === 0 ? (
          <div className="rounded-2xl border border-brand-100 bg-white">
            <EmptyState title="Every dish is priced fine right now." icon="tag" />
          </div>
        ) : (
          <div className="grid gap-3">
            {suggested.slice(0, PREVIEW).map((s) => <SuggestionCard key={s.dish.id} s={s} />)}
          </div>
        )}
      </PreviewSection>

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
                <Link href="/actions#menu" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Decide in Actions</Link>
              </div>
            </div>
          </Fold>
        </section>
      )}

      {changes.length > 0 && (
        <PreviewSection
          title="Copy price changes to your other systems"
          description="This app can't change the POS or delivery apps by itself yet. Tick each one once it's done."
          href="/menu/changes"
          total={changes.length}
          shown={Math.min(PREVIEW, changes.length)}
        >
          <div className="grid gap-2">
            {copyFirst(changes).slice(0, PREVIEW).map((c) => <ChangeRow key={c.id} c={c} />)}
          </div>
        </PreviewSection>
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
