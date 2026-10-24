import Link from "next/link";
import { Suspense } from "react";
import AiSummary from "@/components/analytics/AiSummary";
import AlertList from "@/components/analytics/AlertList";
import ChartCard from "@/components/analytics/ChartCard";
import { DailyRevenueChart } from "@/components/analytics/Charts";
import KpiExplorer from "@/components/analytics/KpiExplorer";
import { kpiCards } from "@/components/analytics/kpiCards";
import PeriodPicker from "@/components/analytics/PeriodPicker";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import { parseDays } from "@/lib/analytics";
import { MODULES, alertCountsByModule, moduleSummary } from "@/lib/analyticsSections";
import { buildAlerts } from "@/lib/insights";
import { loadAnalytics } from "./data";

// The Analytics overview answers "are we OK, and what needs attention?" in one screen:
// a short AI summary, the key numbers, the top changes and the sales trend.
// Everything else is one click away on its own page.

const TOP_ALERTS = 3;

export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <div>
      <PageHeader title="Analytics" description="How the restaurant is doing, and what to pay attention to." />
      {/* searchParams are only known at request time, so read them inside Suspense */}
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading...</span>
      <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}

async function Overview({ searchParams }: { searchParams: PageProps<"/analytics">["searchParams"] }) {
  const params = await searchParams;
  const days = parseDays(Array.isArray(params.days) ? params.days[0] : params.days);

  const loaded = await loadAnalytics(days);
  if ("error" in loaded) return <ErrorMessage message={loaded.error} />;
  const { digest, report, stale } = loaded;

  const alerts = buildAlerts(digest);
  const counts = alertCountsByModule(alerts);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker days={days} period={digest.period} />
        <Link
          href={`/analytics/compare?days=${days}`}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-500"
        >
          Compare numbers →
        </Link>
      </div>

      {/* 1. The AI's one-paragraph read, and what to do first. */}
      <AiSummary report={report} stale={stale} days={days} />

      {/* 2. The six numbers that matter. Click one for how it's worked out. */}
      <ChartCard chart="kpis" title="Key numbers">
        {digest.kpis.cur ? (
          <>
            <p className="-mt-2 mb-3 text-xs text-gray-500">Click a number to see how it&apos;s worked out.</p>
            <KpiExplorer cards={kpiCards(digest)} hasPrevious={Boolean(digest.kpis.prev)} days={days} />
          </>
        ) : (
          <p className="text-sm text-gray-500">No orders in this period.</p>
        )}
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* 3. The biggest changes, by fixed rules (no AI). The rest is on its own page. */}
        <div className="lg:col-span-2">
          <ChartCard
            chart="alerts"
            title="What changed"
            action={
              <Link href={`/analytics/changes?days=${days}`} className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
                See all {alerts.length} →
              </Link>
            }
          >
            <AlertList alerts={alerts.slice(0, TOP_ALERTS)} days={days} compact />
            {alerts.length > TOP_ALERTS && (
              <Link
                href={`/analytics/changes?days=${days}`}
                className="mt-3 inline-block text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline"
              >
                {alerts.length - TOP_ALERTS} more change{alerts.length - TOP_ALERTS === 1 ? "" : "s"} →
              </Link>
            )}
          </ChartCard>
        </div>

        {/* 4. The one chart a restaurant should always see: sales, day by day. */}
        <div className="lg:col-span-3">
          <ChartCard
            chart="daily"
            title="Revenue per day"
            action={
              <Link href={`/analytics/sales?days=${days}`} className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
                Open Sales →
              </Link>
            }
          >
            <DailyRevenueChart daily={digest.daily} />
          </ChartCard>
        </div>
      </div>

      {/* 5. Everything else, one page per area. */}
      <section aria-labelledby="explore-heading">
        <h2 id="explore-heading" className="text-base font-semibold text-gray-900">
          Explore
        </h2>
        <p className="mb-3 text-sm text-gray-500">Each area has its own page with the full charts and the AI&apos;s notes.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((m) => {
            const c = counts[m.id];
            return (
              <Link
                key={m.id}
                href={`/analytics/${m.id}?days=${days}`}
                className="group flex h-full flex-col rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{m.title}</span>
                  {c.bad > 0 && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">{c.bad} to look at</span>
                  )}
                  {c.good > 0 && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">{c.good} good</span>}
                </span>
                <span className="mt-0.5 text-xs text-gray-500">{m.question}</span>
                <span className="mt-3 text-sm text-gray-700">{moduleSummary(m.id, digest)}</span>
                <span className="mt-auto pt-3 text-xs font-medium text-gray-500 group-hover:text-gray-900">Open →</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
