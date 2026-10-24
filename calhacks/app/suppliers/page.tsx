import Link from "next/link";
import { Suspense } from "react";
import MarketButton from "@/components/analytics/MarketButton";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import FindSuppliersButton from "@/components/suppliers/FindSuppliersButton";
import JumpCard from "@/components/suppliers/JumpCard";
import MarketDetail from "@/components/suppliers/MarketDetail";
import MarketSeriesChart from "@/components/suppliers/MarketSeriesChart";
import type { Digest } from "@/lib/analytics";
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
  const { data, error } = await supabase
    .from("suppliers")
    .select("name, category, contact_name, phone, preferred_channel, lead_time_days, delivery_days")
    .eq("restaurant_id", RESTAURANT_ID)
    .order("name");
  if (error) return <ErrorMessage message={error.message} />;

  return (
    <SimpleTable
      columns={[
        { key: "name", label: "Supplier" },
        { key: "category", label: "Category" },
        { key: "contact_name", label: "Contact" },
        { key: "phone", label: "Phone" },
        { key: "preferred_channel", label: "Order by" },
        { key: "lead_time_days", label: "Lead time (days)" },
        { key: "delivery_days", label: "Delivers" },
      ]}
      rows={(data ?? []).map((row) => ({
        ...row,
        phone: row.phone ? (
          <a href={telHref(String(row.phone))} className="font-medium text-gray-900 underline">
            {row.phone}
          </a>
        ) : (
          ""
        ),
      }))}
    />
  );
}

function phoneFor(name: string | null, phones: Map<string, string>): string | null {
  if (!name) return null;
  const phone = phones.get(name.trim().toLowerCase());
  return phone || null;
}

function PriceJumps() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading price jumps...</p>}>
      <PriceJumpsContent />
    </Suspense>
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

      <MarketDetail>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Supplier price changes</h3>
        <SimpleTable
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
            previous_price: formatMoney(change.previous_price),
            current_price: formatMoney(change.current_price),
            change: `${change.change_pct > 0 ? "+" : ""}${change.change_pct}%`,
            impact: change.est_period_impact == null ? "-" : formatMoney(change.est_period_impact),
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
        <p className="order-3 text-sm text-gray-500 md:order-none">No supplier price increases in the last 30 days.</p>
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
    </section>
  );
}

export default function SuppliersPage() {
  return (
    <div>
      <PageHeader title="Suppliers" description="See who you buy from, whether a price jump is the wider market, and who to call." />
      <PriceJumps />
      <h2 className="mb-3 text-lg font-semibold">Contacts on file</h2>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
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
