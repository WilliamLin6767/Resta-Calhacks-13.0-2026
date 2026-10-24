import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import type { TabSummary } from "@/lib/attention/ai";
import { loadBar, writeSummary } from "@/lib/attention/service";
import type { Tab, TabFacts } from "@/lib/attention/types";
import { getSupabase } from "@/lib/supabase";
import AttentionList from "./AttentionList";

const STATUS = {
  good: { label: "All good", className: "bg-green-50 text-green-700" },
  watch: { label: "Watch", className: "bg-amber-50 text-amber-800" },
  act: { label: "Act today", className: "bg-red-50 text-red-700" },
};

function SummaryView({ summary }: { summary: TabSummary }) {
  return (
    <div className="mb-3">
      <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">AI summary</span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[summary.status].className}`}>{STATUS[summary.status].label}</span>
        <span className="basis-full sm:basis-auto">{summary.headline}</span>
      </p>
      {summary.look_closer.length > 0 && (
        <ul className="mt-2 grid gap-1 text-sm text-gray-700">
          {summary.look_closer.map((l) => (
            <li key={l.title}>
              <span className="font-medium">Worth a closer look: {l.title}.</span> {l.why}
            </li>
          ))}
        </ul>
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
  if (!summary) return <p className="mb-3 text-sm text-gray-500">No AI summary right now ({problem}). The list below is still up to date.</p>;
  return <SummaryView summary={summary} />;
}

async function Bar({ tab }: { tab: Tab }) {
  let bar;
  try {
    bar = await loadBar(await getSupabase(), tab);
  } catch (err) {
    return <ErrorMessage message={err instanceof Error ? err.message : String(err)} />;
  }
  const count = bar.items.filter((i) => i.level === "act").length;
  return (
    <>
      <Suspense fallback={<p className="mb-3 text-sm text-gray-400">Writing the AI summary...</p>}>
        <Summary saved={bar.summary} facts={bar.facts} hash={bar.hash} />
      </Suspense>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{count ? `${count} to decide` : "To-do"}</p>
      <AttentionList items={bar.items} />
    </>
  );
}

// The bar at the top of a tab: an AI summary of the tab, then what needs the owner, with the buttons to act.
export default function AttentionBar({ tab }: { tab: Tab }) {
  return (
    <section className="mb-8 rounded-xl border border-gray-200/80 bg-gray-50/60 p-4 shadow-sm">
      <Suspense fallback={<p className="text-sm text-gray-400">Checking what needs you...</p>}>
        <Bar tab={tab} />
      </Suspense>
    </section>
  );
}
