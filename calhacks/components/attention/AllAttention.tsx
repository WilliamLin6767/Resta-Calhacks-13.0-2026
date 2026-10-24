import { Suspense } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import { loadBar } from "@/lib/attention/service";
import { TAB_LABELS, TABS } from "@/lib/attention/types";
import { getSupabase } from "@/lib/supabase";
import AttentionList from "./AttentionList";

// Every tab's "Needs you" items in one list, decisions first. Shows each tab's saved AI headline
// but never writes new summaries (that happens when the tab itself is opened).
async function All() {
  const db = await getSupabase();
  const settled = await Promise.allSettled(TABS.map((tab) => loadBar(db, tab)));
  const bars = TABS.map((tab, i) => ({ tab, result: settled[i] }));
  const failed = bars.filter((b) => b.result.status === "rejected").map((b) => b.tab);
  const ok = bars.flatMap((b) => (b.result.status === "fulfilled" ? [{ tab: b.tab, ...b.result.value }] : []));
  const order = { act: 0, watch: 1, info: 2 };
  const items = ok.flatMap((b) => b.items).sort((a, b) => order[a.level] - order[b.level]);
  const headlines = ok.flatMap((b) => (b.summary ? [{ tab: b.tab, headline: b.summary.headline }] : []));
  const decisions = items.filter((item) => item.level === "act").length;
  return (
    <>
      <p className="mb-3 text-sm text-gray-700 md:hidden">
        {decisions === 0 ? "Nothing needs a decision." : `${decisions} to decide`}
      </p>
      {headlines.length > 0 && (
        <ul className="mb-3 hidden gap-1 text-sm md:grid">
          {headlines.map(({ tab, headline }) => (
            <li key={tab}><span className="font-medium">{TAB_LABELS[tab].label}:</span> <span className="text-gray-700">{headline}</span></li>
          ))}
        </ul>
      )}
      <AttentionList items={items} showTab limit={8} />
      {failed.length > 0 && <ErrorMessage message={`Couldn't check: ${failed.map((t) => TAB_LABELS[t].label).join(", ")}.`} />}
    </>
  );
}

export default function AllAttention() {
  return (
    <section className="mb-8 rounded-xl border border-gray-200/80 bg-gray-50/60 p-4 shadow-sm">
      <h2 className="mb-3 font-semibold">Needs you</h2>
      <Suspense fallback={<p className="text-sm text-gray-400">Checking every tab...</p>}>
        <All />
      </Suspense>
    </section>
  );
}
