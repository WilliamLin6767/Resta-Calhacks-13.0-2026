import { Suspense } from "react";
import { HealthBadge } from "@/components/analytics/AiSummary";
import ErrorMessage from "@/components/ErrorMessage";
import AiThinking from "@/components/ui/AiThinking";
import { SkeletonLines } from "@/components/ui/Skeleton";
import type { TabSummary } from "@/lib/attention/ai";
import { loadBar, writeSummary } from "@/lib/attention/service";
import type { Tab, TabFacts } from "@/lib/attention/types";
import { getSupabase } from "@/lib/supabase";
import AttentionList from "./AttentionList";

function SummaryView({ summary }: { summary: TabSummary }) {
  return (
    <div className="mb-4 border-b border-gray-100 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">✦ AI summary</p>
        <HealthBadge health={summary.status} />
      </div>
      <p className="mt-1.5 text-base font-medium text-gray-900">{summary.headline}</p>
      {summary.look_closer.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
            {summary.look_closer.length === 1 ? "1 thing worth a closer look" : `${summary.look_closer.length} things worth a closer look`}
          </summary>
          <ul className="mt-1.5 grid gap-1 text-sm text-gray-700">
            {summary.look_closer.map((l) => (
              <li key={l.title}><span className="font-medium">{l.title}:</span> {l.why}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// Written only when this tab's numbers changed since the last summary; otherwise the saved one shows.
async function Summary({ saved, facts, hash }: { saved: TabSummary | null; facts: TabFacts; hash: string }) {
  let summary = saved;
  let problem = "";
  if (!summary) {
    try {
      summary = await writeSummary(await getSupabase(), facts, hash);
    } catch (err) {
      problem = err instanceof Error ? err.message : "unavailable";
    }
  }
  if (!summary) return <p className="mb-4 border-b border-gray-100 pb-4 text-sm text-gray-500">No AI summary right now ({problem}). The list below is still up to date.</p>;
  return <SummaryView summary={summary} />;
}

async function Bar({ tab }: { tab: Tab }) {
  let bar;
  try {
    bar = await loadBar(await getSupabase(), tab);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  return (
    <>
      <Suspense fallback={<AiThinking label="Writing the AI summary..." className="mb-4 border-b border-gray-100 pb-4" />}>
        <Summary saved={bar.summary} facts={bar.facts} hash={bar.hash} />
      </Suspense>
      <AttentionList items={bar.items} />
    </>
  );
}

// The bar at the top of a tab: an AI summary of the tab, then what needs the owner, with the buttons to act.
export default function AttentionBar({ tab }: { tab: Tab }) {
  return (
    <section className="mb-8 rounded-2xl border border-brand-100 bg-white p-4 sm:p-5">
      <Suspense fallback={<SkeletonLines lines={3} />}>
        <Bar tab={tab} />
      </Suspense>
    </section>
  );
}
