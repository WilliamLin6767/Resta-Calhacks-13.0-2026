import ChartView from "@/components/assistant/ChartView";
import ExplainButton from "@/components/assistant/ExplainButton";
import type { AiSection } from "@/lib/analytics";
import type { ChartId } from "@/lib/assistant";

const STATUS_STYLES = {
  good: { label: "Good", dot: "bg-green-500" },
  neutral: { label: "Neutral", dot: "bg-gray-400" },
  concern: { label: "Concern", dot: "bg-red-500" },
};

// A chart with its title, an Explain button and, if there is a saved AI report, its note.
// `title` must match chartContext(chart).title in lib/assistant.ts, so the assistant and the page agree.
export default function ChartCard({
  chart,
  title,
  note,
  action,
  children,
}: {
  chart: ChartId;
  title: string;
  note?: AiSection;
  action?: React.ReactNode; // optional extra link next to Explain
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-brand-100 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <div className="flex items-center gap-2">
          {action}
          <ExplainButton target={{ chart }} title={title} />
        </div>
      </div>
      <ChartView target={{ chart }} title={title}>
        {children}
      </ChartView>
      {note && <AiNote note={note} />}
    </section>
  );
}

// The AI report's note for one chart.
export function AiNote({ note }: { note: AiSection }) {
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 text-sm">
      <p className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-500">
        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[note.status].dot}`} />
        AI note · {STATUS_STYLES[note.status].label}
      </p>
      <p className="text-gray-600">{note.what_it_shows}</p>
      <p className="mt-1 text-gray-800">{note.what_it_means}</p>
    </div>
  );
}
