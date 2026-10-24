import Link from "next/link";
import { Suspense } from "react";
import MarketButton from "@/components/analytics/MarketButton";
import { CallBadge, CheckForCalls, RequestCall } from "@/components/calls/CallControls";
import CallRequests from "@/components/calls/CallRequests";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import EmptyState from "@/components/ui/EmptyState";
import Fold from "@/components/ui/Fold";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import FindSuppliersButton from "@/components/suppliers/FindSuppliersButton";
import JumpCard from "@/components/suppliers/JumpCard";
import MarketDetail from "@/components/suppliers/MarketDetail";
import MarketSeriesChart from "@/components/suppliers/MarketSeriesChart";
import type { Digest } from "@/lib/analytics";
import { formatPhone, normalizePhone } from "@/lib/calls/phone";
import { pendingCounts } from "@/lib/calls/service";
import { formatMoney } from "@/lib/format";
import { telHref } from "@/lib/market/leads";
import { chartSeries, explainMarket, ingredientFamily, type IngredientFamily } from "@/lib/market/judge";
import { pointsFromRows } from "@/lib/market/usda";
import { getSupabase, RESTAURANT_ID } from "@/lib/supabase";

type QuoteRow = {
  report_id: number | null;
  commodity: string | null;
  class: string | null;
  price_unit: string | null;
  market_location: string | null;
  report_date: string | null;
  price_avg: number | null;
  ingredient_family: string | null;
  cache_refreshed_at: string | null;
};

type LeadRow = {
  ingredient_name: string;
  company_name: string;
  phone: string;
  website: string | null;
  city: string | null;
  state: string | null;
  matched_product: string | null;
};

async function SuppliersTable() {
  const supabase = await getSupabase();
  const [{ data, error }, counts] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, category, contact_name, phone, preferred_channel, lead_time_days, delivery_days")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("name"),
    pendingCounts(supabase).catch(() => null),
  ]);
  if (error) return <ErrorMessage message={error.message} />;
  const n = data?.length ?? 0;

  return (
    <Fold summary={<span className="text-gray-700">{n} {n === 1 ? "supplier" : "suppliers"} on file, with phone numbers and delivery days</span>}>
      <SimpleTable
        empty={<EmptyState title="No suppliers on file yet." icon="truck" />}
        columns={[
          { key: "name", label: "Supplier" },
          { key: "category", label: "Category" },
          { key: "contact_name", label: "Contact" },
          { key: "phone", label: "Phone" },
          { key: "preferred_channel", label: "Order by" },
          { key: "lead_time_days", label: "Lead time (days)" },
          { key: "delivery_days", label: "Delivers" },
        ]}
        rows={(data ?? []).map((row) => {
          const phone = normalizePhone(row.phone);
          return {
            ...row,
            name: (
              <>
                {row.name}
                <CallBadge count={counts?.bySupplier[row.id]} />
              </>
            ),
            phone: phone ? (
              <a href={telHref(phone)} className="font-medium text-gray-900 underline">
                {formatPhone(phone)}
              </a>
            ) : (
              <span className="text-gray-400">none on file</span>
            ),
          };
        })}
      />
    </Fold>
  );
}

// The owner's own call request: pick a supplier, say what to ask.
async function RequestCallForm() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("suppliers").select("id, name, phone").eq("restaurant_id", RESTAURANT_ID).order("name");
  if (error) return <ErrorMessage message={error.message} />;
  return <RequestCall suppliers={(data ?? []).map((s) => ({ id: s.id, name: s.name, has_phone: normalizePhone(s.phone) !== null }))} />;
}

function phoneFor(name: string | null, phones: Map<string, string>): string | null {
  if (!name) return null;
  const phone = phones.get(name.trim().toLowerCase());
  return phone || null;
}

function PriceJumps() {
  return (
    <Suspense fallback={<PriceJumpsSkeleton />}>
      <PriceJumpsContent />
    </Suspense>
  );
}

// A heading and a couple of price-jump cards, while they load.
function PriceJumpsSkeleton() {
  return (
    <div role="status" className="mb-10 space-y-4">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl" />
    </div>
  );
}

async function PriceJumpsContent() {
  const supabase = await getSupabase();
  const [digestResult, supplierResult, quotesResult, leadsResult] = await Promise.all([
    supabase.rpc("analytics_digest", { p_restaurant_id: RESTAURANT_ID, p_days: 30 }),
    supabase.from("suppliers").select("name, phone").eq("restaurant_id", RESTAURANT_ID),
    supabase
      .from("market_quotes")
      .select("report_id, commodity, class, price_unit, market_location, report_date, price_avg, ingredient_family, cache_refreshed_at")
      .eq("source", "usda_ams"),
    supabase
      .from("supplier_leads")
      .select("ingredient_name, company_name, phone, website, city, state, matched_product")
      .eq("source", "thomasnet"),
  ]);

  if (digestResult.error) return <ErrorMessage message={digestResult.error.message} />;
  const digest = digestResult.data as Digest;
  const jumps = (digest.price_changes ?? []).filter((change) => change.change_pct > 0);
  const phones = new Map(
    (supplierResult.data ?? []).map((supplier) => [String(supplier.name).trim().toLowerCase(), String(supplier.phone ?? "")]),
  );
  const quotes = (quotesResult.data ?? []) as QuoteRow[];
  const points = pointsFromRows(quotes);
  const refreshed = quotes
    .map((quote) => quote.cache_refreshed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const leads = (leadsResult.data ?? []) as LeadRow[];
  const quotesMissing = quotesResult.error != null && /market_quotes|schema cache|does not exist/i.test(quotesResult.error.message);
  const leadsMissing = leadsResult.error != null && /supplier_leads|schema cache|does not exist/i.test(leadsResult.error.message);

  const families = [...new Set(jumps.map((jump) => ingredientFamily(jump.ingredient)).filter((family): family is IngredientFamily => family != null))];

  return (
    <section className="mb-10 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold">Price jumps</h2>
          <p className="mt-1 text-sm text-gray-500">
            USDA livestock and dairy prices are a public market index, not a supplier you can order from.
            {refreshed ? ` Cache refreshed ${new Date(refreshed).toLocaleString("en-US")}.` : " No USDA check saved yet."}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <MarketButton />
          <FindSuppliersButton />
        </div>
      </div>
      {quotesResult.error && (
        <ErrorMessage message={quotesMissing ? `Run supabase/09_market.sql in the Supabase SQL editor. ${quotesResult.error.message}` : quotesResult.error.message} />
      )}
      {leadsResult.error && (
        <ErrorMessage message={leadsMissing ? `Run supabase/12_supplier_leads.sql in the Supabase SQL editor. ${leadsResult.error.message}` : leadsResult.error.message} />
      )}

      <Fold
        summary={
          jumps.length > 0 ? (
            <span className="flex items-center gap-2 font-medium text-gray-900"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />{jumps.length} supplier {jumps.length === 1 ? "price" : "prices"} went up in the last 30 days</span>
          ) : (
            <span className="text-gray-600">No supplier price increases in the last 30 days</span>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <MarketDetail>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Supplier price changes</h3>
            <SimpleTable
              empty={<EmptyState title="No supplier price changes in this period." />}
              columns={[
                { key: "ingredient", label: "Ingredient" },
                { key: "supplier", label: "Supplier" },
                { key: "since", label: "Since" },
                { key: "previous_price", label: "Was" },
                { key: "current_price", label: "Now" },
                { key: "change", label: "Change" },
                { key: "impact", label: "Est. cost this period" },
                { key: "cheapest", label: "Cheapest option" },
                { key: "dishes", label: "Used in" },
              ]}
              rows={(digest.price_changes ?? []).map((change) => ({
                ingredient: change.ingredient,
                supplier: change.supplier,
                since: change.since,
                previous_price: <span className="tabular-nums">{formatMoney(change.previous_price)}</span>,
                current_price: <span className="tabular-nums">{formatMoney(change.current_price)}</span>,
                change: <span className="tabular-nums">{`${change.change_pct > 0 ? "+" : ""}${change.change_pct}%`}</span>,
                impact: change.est_period_impact == null ? "-" : <span className="tabular-nums">{formatMoney(change.est_period_impact)}</span>,
                cheapest: change.cheapest_supplier ?? "-",
                dishes: change.dishes.join(", "),
              }))}
            />
          </div>

          {families.map((family) => {
            const series = chartSeries(points, family);
            if (!series) return null;
            return (
              <div key={family} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="mb-2 text-sm font-medium text-gray-800">{family === "beef" ? "Cattle market" : "Dairy market"}</p>
                <p className="mb-2 text-xs text-gray-500">{series.label}</p>
                <MarketSeriesChart rows={series.rows} />
              </div>
            );
          })}
          </MarketDetail>

          {jumps.length === 0 ? (
            <div className="order-3 md:order-none">
              <EmptyState title="No supplier price increases in the last 30 days." icon="truck" />
            </div>
          ) : (
            <div className="order-3 space-y-4 md:order-none">
              {jumps.map((jump) => {
                const market = explainMarket({
                  ingredient: jump.ingredient,
                  supplierChangePct: jump.change_pct,
                  since: jump.since,
                  quotes: points,
                });
                const currentPhone = phoneFor(jump.supplier, phones);
                const cheaperPhone = phoneFor(jump.cheapest_supplier, phones);
                const calls = leads.filter((lead) => lead.ingredient_name === jump.ingredient).slice(0, 3);
                return (
                  <JumpCard
                    key={`${jump.ingredient}-${jump.supplier}`}
                    ingredient={jump.ingredient}
                    changePct={jump.change_pct}
                    since={jump.since}
                    supplier={jump.supplier}
                    cheapestSupplier={jump.cheapest_supplier}
                    impact={jump.est_period_impact == null ? null : formatMoney(jump.est_period_impact)}
                    currentPhone={currentPhone}
                    cheaperPhone={cheaperPhone}
                    verdict={market.verdict}
                    detail={market.detail}
                    calls={calls}
                    leadsMissing={leadsResult.error != null}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Fold>
    </section>
  );
}

export default function SuppliersPage() {
  return (
    <div>
      <PageHeader title="Suppliers" description="See who you buy from, whether a price jump is the wider market, and who to call." />
      {/* Every call request, for any record: the one place to approve them all. Nothing dials until "Approve and call". */}
      <section className="mb-10 space-y-4">
        <CallRequests title="Supplier calls" action={<CheckForCalls />} />
        <Suspense fallback={<Skeleton className="h-[150px] rounded-2xl" />}>
          <RequestCallForm />
        </Suspense>
      </section>
      <PriceJumps />
      <h2 className="mb-3 text-lg font-semibold">Contacts on file</h2>
      <Suspense fallback={<SkeletonTable rows={4} cols={7} />}>
        <SuppliersTable />
      </Suspense>
      <p className="mt-4 text-sm text-gray-500">
        An order to a cheaper supplier already on file starts from{" "}
        <Link href="/invoices" className="font-medium text-gray-900 hover:underline">
          Invoices and buying
        </Link>
        . These outside numbers are for a call, not a purchase order.
      </p>
    </div>
  );
}
