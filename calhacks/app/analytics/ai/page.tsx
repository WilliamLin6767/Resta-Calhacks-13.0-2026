import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HealthBadge, StaleBadge } from "@/components/analytics/AiSummary";
import AnalyzeButton from "@/components/analytics/AnalyzeButton";
import AskChips from "@/components/analytics/AskChips";
import { AiNote } from "@/components/analytics/ChartCard";
import PeriodPicker from "@/components/analytics/PeriodPicker";
import ErrorMessage from "@/components/ErrorMessage";
import { parseDays } from "@/lib/analytics";
import { ACTION_AREA_MODULE, MODULES, aiNotesForModule, getModule } from "@/lib/analyticsSections";
import { loadAnalytics } from "../data";

export const metadata: Metadata = { title: "AI analysis · Analytics" };

// The full AI report: the headline, every suggested action (linked to the page it's about),
// and the AI's note on each area.
export default function AiPage({ searchParams }: PageProps<"/analytics/ai">) {
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-gray-500">
        <Link href="/analytics" className="hover:text-gray-900 hover:underline">
          Analytics
        </Link>{" "}
        / <span className="text-gray-900">AI analysis</span>
      </nav>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">✦ AI analysis</h1>
        <p className="mt-1 text-sm text-gray-600">
          A plain-language read of your numbers. The AI only uses numbers from the dashboard; estimates are labeled.
        </p>
      </header>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-100" aria-label="Loading..." />}>
        <AiContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AiContent({ searchParams }: { searchParams: PageProps<"/analytics/ai">["searchParams"] }) {
  const params = await searchParams;
  const days = parseDays(Array.isArray(params.days) ? params.days[0] : params.days);
  const loaded = await loadAnalytics(days);
  if ("error" in loaded) return <ErrorMessage message={loaded.error} />;
  const { digest, report, stale, savedAt, model } = loaded;

  return (
    <div className="space-y-6">
      <PeriodPicker days={days} period={digest.period} basePath="/analytics/ai" />

      <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {report ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <HealthBadge health={report.health} />
                  {stale && <StaleBadge />}
                </div>
                <p className="mt-2 text-lg font-medium text-gray-900">{report.headline}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Written {savedAt ? new Date(savedAt).toLocaleString("en-US") : ""}
                  {model ? ` by ${model}` : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-600">
                No AI analysis for the last {days} days yet. It takes about 30 seconds and is saved, so the next visit is instant.
              </p>
            )}
          </div>
          <AnalyzeButton days={days} />
        </div>
      </section>

      {report && (
        <>
          <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Suggested actions, most valuable first</h2>
            <ol className="space-y-3">
              {report.actions.map((action, i) => {
                const moduleDef = getModule(ACTION_AREA_MODULE[action.area]);
                return (
                  <li key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-gray-900">
                        {i + 1}. {action.title}
                      </p>
                      <Link
                        href={`/analytics/${moduleDef.id}?days=${days}`}
                        className="shrink-0 text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline"
                      >
                        Open {moduleDef.title} →
                      </Link>
                    </div>
                    <p className="mt-1 text-gray-700">{action.why}</p>
                    <p className="mt-1 text-gray-500">{action.estimated_impact}</p>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-gray-900">Notes by area</h2>
            <div className="divide-y divide-gray-100">
              {MODULES.map((m) => {
                const notes = aiNotesForModule(report, m.id);
                if (notes.length === 0) return null;
                return (
                  <div key={m.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-gray-900">{m.title}</h3>
                      <Link href={`/analytics/${m.id}?days=${days}`} className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
                        Open →
                      </Link>
                    </div>
                    {notes.map((n) => (
                      <AiNote key={n.id} note={n} />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">✦ Ask a follow-up</h2>
        <AskChips questions={["What should I do this week?", "What is going well?", "What is the biggest risk right now?"]} />
      </section>
    </div>
  );
}
