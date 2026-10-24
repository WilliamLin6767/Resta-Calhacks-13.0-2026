import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import AlertList from "@/components/analytics/AlertList";
import AskChips from "@/components/analytics/AskChips";
import ChartCard from "@/components/analytics/ChartCard";
import PeriodPicker from "@/components/analytics/PeriodPicker";
import ErrorMessage from "@/components/ErrorMessage";
import { parseDays } from "@/lib/analytics";
import { ALERT_THRESHOLDS, buildAlerts } from "@/lib/insights";
import { loadAnalytics } from "../data";

export const metadata: Metadata = { title: "What changed · Analytics" };

// Every "What changed" alert with its full detail, and how the alerts are picked.
export default function ChangesPage({ searchParams }: PageProps<"/analytics/changes">) {
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-gray-500">
        <Link href="/analytics" className="hover:text-gray-900 hover:underline">
          Analytics
        </Link>{" "}
        / <span className="text-gray-900">What changed</span>
      </nav>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">What changed</h1>
        <p className="mt-1 text-sm text-gray-600">The numbers that moved enough to need a look, compared with the period before.</p>
      </header>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-100" aria-label="Loading..." />}>
        <ChangesContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ChangesContent({ searchParams }: { searchParams: PageProps<"/analytics/changes">["searchParams"] }) {
  const params = await searchParams;
  const days = parseDays(Array.isArray(params.days) ? params.days[0] : params.days);
  const loaded = await loadAnalytics(days);
  if ("error" in loaded) return <ErrorMessage message={loaded.error} />;
  const { digest } = loaded;
  const alerts = buildAlerts(digest);
  const t = ALERT_THRESHOLDS;

  return (
    <div className="space-y-6">
      <PeriodPicker days={days} period={digest.period} basePath="/analytics/changes" />

      <ChartCard chart="alerts" title="What changed">
        <AlertList alerts={alerts} days={days} />
      </ChartCard>

      <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">✦ Ask about these changes</h2>
        <AskChips questions={["What should I do about these changes first?", "Are any of these changes worrying?"]} />
      </section>

      <section className="rounded-xl border border-gray-200/80 bg-white p-5 text-sm text-gray-600 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">How these are picked</h2>
        <p className="mb-2">Fixed rules, not AI. Each one compares this period with the same-length period before it:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Revenue per open day moved {t.revenuePerOpenDayPct}% or more (or total revenue and revenue per open day disagree because open days differ).</li>
          <li>Food cost moved {t.foodCostPts} percentage points or more.</li>
          <li>A supplier price increase is costing you money at your current sales.</li>
          <li>
            A channel with at least {t.channelMinSharePct}% of revenue kept {t.channelNetPct}% more or less after fees.
          </li>
          <li>
            A dish selling at least {t.dishMinUnits} moved {t.dishUnitsPct}% or more (up to {t.maxDishAlerts} dishes).
          </li>
        </ul>
        <p className="mt-2 text-xs text-gray-500">These thresholds are judgment calls for a small restaurant, not industry standards.</p>
      </section>
    </div>
  );
}
