import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ChartView from "@/components/assistant/ChartView";
import CompareChart from "@/components/assistant/CompareChart";
import ExplainButton from "@/components/assistant/ExplainButton";
import Card from "@/components/Card";
import ErrorMessage from "@/components/ErrorMessage";
import { SkeletonChart } from "@/components/ui/Skeleton";
import PageHeader from "@/components/PageHeader";
import SimpleTable from "@/components/SimpleTable";
import { PERIOD_OPTIONS } from "@/lib/analytics";
import {
  BREAKDOWNS,
  BREAKDOWN_IDS,
  METRICS,
  METRIC_IDS,
  compareSummary,
  compareTitle,
  formatMetricValue,
  invalidPairReason,
  parseCompareQuery,
  rowLabel,
  type CompareQuery,
} from "@/lib/compare";
import { percentChange } from "@/lib/insights";
import { loadCompare } from "../compareData";

export const metadata: Metadata = { title: "Compare · Analytics" };

export default function ComparePage({ searchParams }: PageProps<"/analytics/compare">) {
  return (
    <div>
      <p className="mb-2 text-sm text-gray-500">
        <Link href="/analytics" className="hover:text-gray-900 hover:underline">
          Analytics
        </Link>{" "}
        / Compare
      </p>
      <PageHeader title="Compare" description="Pick one number and one way to split it." />
      {/* searchParams are only known at request time, so read them inside Suspense */}
      <Suspense fallback={<SkeletonChart height={384} />}>
        <CompareContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const href = (q: CompareQuery) => `/analytics/compare?metric=${q.metric}&breakdown=${q.breakdown}&days=${q.days}`;

function Chip({ active, href: to, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={`lift rounded-full border px-3 py-1 text-sm ${
        active ? "border-brand-600 bg-brand-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
      }`}
    >
      {children}
    </Link>
  );
}

async function CompareContent({ searchParams }: { searchParams: PageProps<"/analytics/compare">["searchParams"] }) {
  const query = parseCompareQuery(await searchParams);
  const loaded = await loadCompare(query);

  return (
    <div className="space-y-6">
      {/* Pickers */}
      <Card>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-gray-500 uppercase">Number</p>
            <div className="flex flex-wrap gap-2">
              {METRIC_IDS.map((metric) => {
                // Keep the breakdown if it works with this metric, otherwise use weekday.
                const breakdown = invalidPairReason(metric, query.breakdown) ? "weekday" : query.breakdown;
                return (
                  <Chip key={metric} active={metric === query.metric} href={href({ ...query, metric, breakdown })}>
                    {METRICS[metric].label}
                  </Chip>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-gray-500">{METRICS[query.metric].description}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-gray-500 uppercase">Split by</p>
            <div className="flex flex-wrap gap-2">
              {BREAKDOWN_IDS.map((breakdown) => {
                const reason = invalidPairReason(query.metric, breakdown);
                return reason ? (
                  <span
                    key={breakdown}
                    title={reason}
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-full border border-dashed border-gray-200 px-3 py-1 text-sm text-gray-400"
                  >
                    {BREAKDOWNS[breakdown].label}
                  </span>
                ) : (
                  <Chip key={breakdown} active={breakdown === query.breakdown} href={href({ ...query, breakdown })}>
                    {BREAKDOWNS[breakdown].label}
                  </Chip>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PERIOD_OPTIONS.map((days) => (
              <Chip key={days} active={days === query.days} href={href({ ...query, days })}>
                Last {days} days
              </Chip>
            ))}
          </div>
        </div>
      </Card>

      {"error" in loaded ? (
        <ErrorMessage message={`Could not load this comparison: ${loaded.error}`} />
      ) : (
        (() => {
          const result = loaded.result;
          const title = compareTitle(result);
          const target = { compare: { metric: result.metric, breakdown: result.breakdown } };
          return (
            <Card title={title} action={<ExplainButton target={target} title={title} />}>
              <ChartView target={target} title={title}>
                <CompareChart result={result} />
                <p className="mt-3 text-sm text-gray-600">{compareSummary(result)}</p>
                <div className="mt-4">
                  <SimpleTable
                    columns={[
                      { key: "label", label: BREAKDOWNS[result.breakdown].label },
                      { key: "value", label: "This period" },
                      ...(result.has_previous && result.breakdown !== "day"
                        ? [
                            { key: "prev", label: "Previous period" },
                            { key: "change", label: "Change" },
                          ]
                        : []),
                    ]}
                    rows={result.rows.map((r) => {
                      const change = percentChange(r.value, r.prev_value);
                      return {
                        label: rowLabel(result.breakdown, r),
                        value: formatMetricValue(result.metric, r.value),
                        prev: formatMetricValue(result.metric, r.prev_value),
                        change: change === null ? "-" : `${change > 0 ? "+" : ""}${change}%`,
                      };
                    })}
                  />
                </div>
              </ChartView>
            </Card>
          );
        })()
      )}
    </div>
  );
}
